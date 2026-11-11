"""B1 contract checks. Synthetic fixtures only; no external API, network or signature keys."""
import copy
from datetime import datetime
import hashlib
import json
import math
from decimal import Decimal, InvalidOperation
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures"
LIMIT_DIAGNOSTIC = 2 * 1024 * 1024
LIMIT_CATALOG = 20 * 1024 * 1024
MAX_DEPTH = 64
MAX_NODES = 100_000
SUPPORTED = "0.1.0"
SCHEMA_PATHS = {
    "diagnostic": ROOT / "diagnostic.schema.json",
    "catalog": ROOT / "catalog.schema.json",
    "manifest": ROOT / "catalog-manifest.schema.json",
    "pointer": ROOT / "latest-pointer.schema.json",
}
SCHEMAS = {k: json.loads(p.read_text(encoding="utf-8")) for k, p in SCHEMA_PATHS.items()}
VALIDATORS = {
    k: Draft202012Validator(v, format_checker=FormatChecker())
    for k, v in SCHEMAS.items()
}


class ContractError(ValueError):
    """Expected controlled rejection of a malicious, incompatible or invalid input."""


def _no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ContractError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _nonfinite(value):
    raise ContractError(f"non-finite JSON constant: {value}")


MAX_SAFE_INTEGER = 9007199254740991


def _finite_json_integer(token):
    """A JSON integer must survive transport to JavaScript without rounding."""
    if len(token.lstrip("-")) > 16:
        raise ContractError("unsafe JSON integer")
    value = int(token)
    if abs(value) > MAX_SAFE_INTEGER:
        raise ContractError("unsafe JSON integer")
    return value


def _finite_json_float(token):
    """Reject float overflow, underflow and decimal precision loss before float64 conversion."""
    try:
        original = Decimal(token)
    except InvalidOperation as exc:
        raise ContractError("invalid decimal number") from exc
    if not original.is_finite():
        raise ContractError("non-finite JSON number")
    if original == original.to_integral_value() and abs(original) > MAX_SAFE_INTEGER:
        raise ContractError("unsafe JSON integral number")
    try:
        value = float(original)
    except (ValueError, OverflowError) as exc:
        raise ContractError("JSON float overflow") from exc
    if not math.isfinite(value):
        raise ContractError("JSON float overflow")
    if original != 0 and value == 0:
        raise ContractError("JSON float underflow")
    if Decimal(str(value)) != original:
        raise ContractError("JSON decimal precision loss")
    return value


def _check_in_memory_numbers(value):
    """Also protect validators called on in-memory dictionaries, not only decoded bytes."""
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, bool):
            continue
        if isinstance(item, int) and abs(item) > MAX_SAFE_INTEGER:
            raise ContractError("unsafe JSON integer")
        if isinstance(item, float):
            if not math.isfinite(item):
                raise ContractError("non-finite JSON number")
            if item.is_integer() and abs(item) > MAX_SAFE_INTEGER:
                raise ContractError("unsafe JSON integral number")
        if isinstance(item, dict):
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)


def decode_bounded(raw: bytes, limit: int):
    """Bounded strict UTF-8 parse with explicit numeric compatibility."""
    if len(raw) > limit:
        raise ContractError("input size limit exceeded")
    try:
        data = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_no_duplicate_keys,
            parse_constant=_nonfinite,
            parse_int=_finite_json_integer,
            parse_float=_finite_json_float,
        )
    except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
        if isinstance(exc, ContractError):
            raise
        raise ContractError("invalid UTF-8 or JSON") from exc
    pending = [(data, 1)]
    nodes = 0
    while pending:
        item, depth = pending.pop()
        nodes += 1
        if nodes > MAX_NODES or depth > MAX_DEPTH:
            raise ContractError("JSON structural budget exceeded")
        if isinstance(item, dict):
            pending.extend((v, depth + 1) for v in item.values())
        elif isinstance(item, list):
            pending.extend((v, depth + 1) for v in item)
    _check_in_memory_numbers(data)
    return data

def load_fixture(filename: str):
    return decode_bounded((FIXTURES / filename).read_bytes(), LIMIT_DIAGNOSTIC if "diagnostic" in filename else LIMIT_CATALOG)


def validate(kind: str, data: dict):
    _check_in_memory_numbers(data)
    if not isinstance(data, dict) or data.get("schema_version") != SUPPORTED:
        raise ContractError("unsupported schema version")
    errors = list(VALIDATORS[kind].iter_errors(data))
    if errors:
        errors.sort(key=lambda e: (list(map(str, e.path)), e.message))
        raise ContractError(f"{kind} schema: {errors[0].message}")
    if kind == "diagnostic":
        semantic_diagnostic(data)
    if kind == "catalog":
        semantic_catalog(data)
    if kind == "manifest":
        semantic_manifest(data)


def semantic_diagnostic(data):
    start = datetime.fromisoformat(data["started_at"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(data["finished_at"].replace("Z", "+00:00"))
    if end < start:
        raise ContractError("finished_at earlier than started_at")

    components = {x["component"]: x["status"] for x in data["components"]}
    if len(components) != len(data["components"]):
        raise ContractError("duplicate component name")
    engine_names = [x["name"] for x in data["engines"]]
    if len(engine_names) != len(set(engine_names)):
        raise ContractError("duplicate engine name")
    indices = [x["index"] for x in data["hardware"]["gpus"]]
    if len(indices) != len(set(indices)):
        raise ContractError("duplicate GPU index")

    for engine in data["engines"]:
        # Multiple engines within one subsystem use a component/engine suffix.
        component = engine["name"].split("/", 1)[0]
        if component not in components:
            raise ContractError("engine has no matching component")
        parent = components[component]
        if parent == "skipped" and engine["status"] != "skipped":
            raise ContractError("skipped component has attempted engine")
        if engine["status"] in ("failed", "partial") and parent in ("ok", "skipped"):
            raise ContractError("degraded engine contradicts component status")

    for error in data["errors"]:
        if error["component"] not in components:
            raise ContractError("error references missing component")
        if components[error["component"]] in ("ok", "skipped"):
            raise ContractError("error contradicts component status")

    cloud_status = components.get("cloud")
    if cloud_status == "skipped" and data["cloud_checks"]:
        raise ContractError("skipped cloud component has executed checks")
    for cloud in data["cloud_checks"]:
        if any(p["status"] == "failed" for p in cloud["probes"]):
            if cloud_status not in ("partial", "failed"):
                raise ContractError("failed cloud probe contradicts component status")
        if any(p["http_status"] == 401 for p in cloud["probes"]):
            if cloud["conclusion"] == "connection_failed":
                raise ContractError("HTTP 401 was misclassified as connection failure")

    statuses = list(components.values())
    engine_statuses = [e["status"] for e in data["engines"]]
    degraded = (
        bool(data["errors"])
        or any(x in ("failed", "partial") for x in statuses + engine_statuses)
    )
    useful = any(x in ("ok", "partial") for x in statuses)
    overall = data["overall_status"]
    if overall == "ok":
        if degraded or not any(x == "ok" for x in statuses):
            raise ContractError("overall_status ok contradicts component/engine/error state")
    elif overall == "partial":
        if not useful or not degraded:
            raise ContractError("overall_status partial requires usable and degraded subsystems")
    elif overall == "failed":
        if useful or any(x in ("ok", "partial") for x in engine_statuses) or not degraded:
            raise ContractError("overall_status failed contradicts available diagnostic results")

    for assessment in data["model_assessments"]:
        top_execution = assessment["execution"]
        estimate = assessment["speed_estimate"]
        if estimate is not None:
            if estimate["execution"] != top_execution:
                raise ContractError("speed estimate execution differs from assessment execution")
            if estimate["backend_id"] != top_execution["backend_id"]:
                raise ContractError("speed estimate backend differs from assessment execution")
        for measurement in assessment["measurements"]:
            if measurement["execution"] != top_execution:
                raise ContractError("measurement execution differs from assessment execution")
            expected_unit = {
                "generation_tps": "tokens/s",
                "prompt_tps": "tokens/s",
                "ttft_ms": "ms",
                "total_latency_ms": "ms",
                "peak_working_set_bytes": "bytes",
            }[measurement["kind"]]
            if measurement["unit"] != expected_unit:
                raise ContractError("measurement kind/unit mismatch")

def comparison_status(estimated_assessment, measured_assessment):
    """Assess only configuration comparability across two model assessments."""
    estimate = estimated_assessment.get("speed_estimate")
    if estimate is None:
        return "not_comparable"
    if not measured_assessment.get("measurements"):
        return "not_comparable"
    for key in ("model_id", "artifact_id"):
        a, b = estimated_assessment.get(key), measured_assessment.get(key)
        if a is None or b is None or a != b:
            return "not_comparable"
    a = estimated_assessment["execution"]
    b = measured_assessment["execution"]
    keys = ("device_path", "backend_id", "runtime_id", "runtime_version",
            "context_tokens", "threads", "gpu_layers")
    if a["device_path"] == "unknown":
        return "not_comparable"
    if any(a.get(k) is None or b.get(k) is None or a.get(k) != b.get(k) for k in keys):
        return "not_comparable"
    if not any(m["kind"] == "generation_tps" and m["execution"] == b
               for m in measured_assessment["measurements"]):
        return "not_comparable"
    return "comparable_configuration"

def semantic_catalog(data):
    source_ids = [s["source_id"] for s in data["source_snapshots"]]
    if len(source_ids) != len(set(source_ids)):
        raise ContractError("duplicate catalog source_id")
    known_sources = set(source_ids)
    models = [m["model_id"] for m in data["models"]]
    if len(models) != len(set(models)):
        raise ContractError("duplicate model_id")
    artifact_ids = []
    for model in data["models"]:
        provenance = model["field_provenance"]
        expected = set()
        for key in ("architecture", "parameters", "context_tokens"):
            if model[key] is not None:
                expected.add(key)
        if model["modalities"]:
            expected.add("modalities")
        for i, artifact in enumerate(model["artifacts"]):
            artifact_ids.append(artifact["artifact_id"])
            for key in ("format", "quantization", "size_bytes", "revision",
                        "sha256", "source_uri"):
                if key in artifact and artifact[key] is not None:
                    expected.add(f"artifacts[{i}].{key}")
        if set(provenance) != expected:
            missing = sorted(expected - set(provenance))
            extra = sorted(set(provenance) - expected)
            raise ContractError(f"field_provenance mismatch: missing={missing}, extra={extra}")
        for records in provenance.values():
            if not records:
                raise ContractError("empty field provenance")
            for record in records:
                if record["source_id"] not in known_sources:
                    raise ContractError("unknown provenance source")
        for alias in model["aliases"]:
            if alias["source_id"] not in known_sources:
                raise ContractError("alias has unknown source snapshot")
    if len(artifact_ids) != len(set(artifact_ids)):
        raise ContractError("duplicate artifact_id")
    overrides = set()
    for override in data["llmfit_overrides"]:
        if override["target_model_id"] not in models:
            raise ContractError("override references unknown model")
        if override["source_id"] not in known_sources:
            raise ContractError("override has unknown provenance")
        if override["status"] != "not_applied":
            raise ContractError("llmfit override has not passed CLI PoC")
        key = (override["target_model_id"], override["target_slug"], override["field"])
        if key in overrides:
            raise ContractError("duplicate llmfit override key")
        overrides.add(key)

def semantic_manifest(data):
    if "0.1.0" not in data["compatible_diagnostic_schema_versions"]:
        raise ContractError("manifest does not support diagnostic v0.1.0")
    version = data["catalog_version"]
    for artifact in data["artifacts"]:
        expected = f"/data/catalog/versions/{version}/catalog.json"
        if artifact["path"] != expected:
            raise ContractError("manifest catalog_version and artifact path differ")


def snapshot_integrity(manifest, raw: bytes, signature_verified: bool):
    """Only byte-level tests for B1. NOT an Ed25519 signature verifier."""
    if not signature_verified:
        raise ContractError("unsigned/unverified manifest")
    validate("manifest", manifest)
    if len(manifest["artifacts"]) != 1:
        raise ContractError("unexpected artifact count")
    artifact = manifest["artifacts"][0]
    if len(raw) != artifact["bytes"]:
        raise ContractError("catalog length mismatch")
    if hashlib.sha256(raw).hexdigest() != artifact["sha256"]:
        raise ContractError("catalog digest mismatch")
    validate("catalog", decode_bounded(raw, LIMIT_CATALOG))


class ContractTests(unittest.TestCase):
    def test_all_schemas_are_draft_2020_12(self):
        for kind, schema in SCHEMAS.items():
            with self.subTest(kind=kind):
                self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
                self.assertEqual(schema["$id"], f"urn:neurometr:schema:{'catalog-pointer' if kind == 'pointer' else 'catalog-manifest' if kind == 'manifest' else kind}:0.1.0")
                Draft202012Validator.check_schema(schema)

    def test_positive_diagnostic_fixtures(self):
        for number, filename in enumerate([
            "F01_diagnostic_windows_ok.json",
            "F02_diagnostic_llmfit_timeout.json",
            "F03_diagnostic_offline_site.json",
            "F04_diagnostic_unknown_igpu.json",
            "F05_diagnostic_cpu_vs_sycl.json",
        ], start=1):
            with self.subTest(fixture=f"F{number:02d}"):
                d = load_fixture(filename)
                validate("diagnostic", d)

    def test_f01_cloud_401_is_auth_not_region(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        self.assertEqual(d["cloud_checks"][0]["conclusion"], "auth_required")
        self.assertEqual(d["cloud_checks"][0]["origin"], "local_agent")
        self.assertTrue(d["cloud_checks"][0]["consent"])

    def test_f02_timeout_preserves_hardware(self):
        d = load_fixture("F02_diagnostic_llmfit_timeout.json")
        self.assertEqual(d["overall_status"], "partial")
        self.assertGreater(d["hardware"]["ram"]["physical_total_bytes"], 0)
        self.assertEqual(d["errors"][0]["code"], "LLMFIT_TIMEOUT")
        self.assertEqual(d["model_assessments"], [])

    def test_f03_bundled_offline_no_network(self):
        d = load_fixture("F03_diagnostic_offline_site.json")
        self.assertEqual(d["catalog_ref"]["origin"], "bundled")
        self.assertEqual(d["cloud_checks"], [])
        self.assertEqual(next(x["status"] for x in d["components"] if x["component"] == "cloud"), "skipped")

    def test_f04_unknown_vram_and_npu(self):
        d = load_fixture("F04_diagnostic_unknown_igpu.json")
        gpu = d["hardware"]["gpus"][0]
        self.assertIsNone(gpu["memory"]["dedicated_total_bytes"])
        self.assertIsNone(gpu["memory"]["shared_total_bytes"])
        self.assertEqual(gpu["memory_topology"], "shared")
        self.assertEqual(d["hardware"]["npus"][0]["detection_status"], "unknown")
        self.assertEqual(d["runtime_checks"][0]["launch_status"], "not_tested")

    def test_f05_cpu_and_sycl_not_comparable(self):
        cpu, sycl = load_fixture("F05_diagnostic_cpu_vs_sycl.json")["model_assessments"]
        self.assertIsNone(cpu["speed_estimate"])
        self.assertEqual(cpu["measurements"][0]["evidence"]["kind"], "measured")
        self.assertEqual(sycl["measurements"], [])
        self.assertEqual(sycl["speed_estimate"]["evidence"]["kind"], "estimated")
        self.assertEqual(comparison_status(sycl, cpu), "not_comparable")

    def test_f06_unsupported_version_controlled_failure(self):
        with self.assertRaisesRegex(ContractError, "unsupported schema version"):
            validate("diagnostic", load_fixture("F06_diagnostic_unsupported_schema.json"))

    def test_catalog_and_pointer_are_schema_valid(self):
        validate("catalog", load_fixture("catalog_valid.json"))
        validate("pointer", load_fixture("latest_valid.json"))
        validate("manifest", load_fixture("F07_catalog_invalid_checksum.manifest.json"))

    def test_f07_integrity_rejected_and_unsigned_rejected(self):
        manifest = load_fixture("F07_catalog_invalid_checksum.manifest.json")
        raw = (FIXTURES / "F07_catalog_invalid_checksum.json").read_bytes()
        validate("catalog", decode_bounded(raw, LIMIT_CATALOG))
        with self.assertRaises(ContractError):
            snapshot_integrity(manifest, raw, signature_verified=True)
        with self.assertRaisesRegex(ContractError, "unsigned"):
            snapshot_integrity(manifest, raw, signature_verified=False)

    def test_f08_applied_override_rejected(self):
        with self.assertRaises(ContractError):
            validate("catalog", load_fixture("F08_catalog_incompatible_override.json"))

    def test_size_limit_before_parse(self):
        with self.assertRaisesRegex(ContractError, "size limit"):
            decode_bounded(b" " * (LIMIT_DIAGNOSTIC + 1), LIMIT_DIAGNOSTIC)
        with self.assertRaisesRegex(ContractError, "size limit"):
            decode_bounded(b" " * (LIMIT_CATALOG + 1), LIMIT_CATALOG)

    def test_duplicate_keys_nan_invalid_utf8(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b"\xff"):
            with self.subTest(raw=raw[:20]), self.assertRaises(ContractError):
                decode_bounded(raw, LIMIT_DIAGNOSTIC)

    def test_deep_json_rejected(self):
        raw = b"[" * (MAX_DEPTH + 1) + b"0" + b"]" * (MAX_DEPTH + 1)
        with self.assertRaisesRegex(ContractError, "structural budget"):
            decode_bounded(raw, LIMIT_DIAGNOSTIC)

    def test_bad_types_or_measurement_units_rejected(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["hardware"]["ram"]["physical_total_bytes"] = "16 GiB"
        with self.assertRaises(ContractError):
            validate("diagnostic", d)
        d = load_fixture("F05_diagnostic_cpu_vs_sycl.json")
        d["model_assessments"][0]["measurements"][0]["unit"] = "ms"
        with self.assertRaisesRegex(ContractError, "kind/unit"):
            validate("diagnostic", d)

    def test_date_order_invalid(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["finished_at"] = "2026-11-11T09:59:00Z"
        with self.assertRaisesRegex(ContractError, "earlier"):
            validate("diagnostic", d)

    def test_non_utc_timestamp_rejected(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["started_at"] = "2026-11-11T13:00:00+03:00"
        with self.assertRaises(ContractError):
            validate("diagnostic", d)

    def test_evidence_estimate_not_measured(self):
        d = load_fixture("F05_diagnostic_cpu_vs_sycl.json")
        d["model_assessments"][1]["speed_estimate"]["evidence"]["kind"] = "measured"
        with self.assertRaises(ContractError):
            validate("diagnostic", d)

    def test_path_traversal_and_external_hosts_rejected(self):
        p = load_fixture("latest_valid.json")
        for bad in ("../../etc/passwd", "https://untrusted.example/manifest.json",
                    "/data/catalog/manifests/../versions/manifest.json"):
            with self.subTest(path=bad), self.assertRaises(ContractError):
                x = copy.deepcopy(p)
                x["manifest_path"] = bad
                validate("pointer", x)
        m = load_fixture("F07_catalog_invalid_checksum.manifest.json")
        m["artifacts"][0]["path"] = "https://invalid.example/catalog.json"
        with self.assertRaises(ContractError):
            validate("manifest", m)

    def test_sha_and_catalog_duplicates_rejected(self):
        c = load_fixture("catalog_valid.json")
        c["models"].append(copy.deepcopy(c["models"][0]))
        with self.assertRaisesRegex(ContractError, "duplicate model_id"):
            validate("catalog", c)
        m = load_fixture("F07_catalog_invalid_checksum.manifest.json")
        m["artifacts"][0]["sha256"] = "not-a-sha"
        with self.assertRaises(ContractError):
            validate("manifest", m)

    def test_xss_is_data_not_markup(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        text = '<img src=x onerror=alert(1)>'
        d["errors"] = [{"component": "hardware", "code": "SYNTHETIC_XSS", "message": text, "retryable": False}]
        d["overall_status"] = "partial"
        next(comp for comp in d["components"] if comp["component"] == "hardware")["status"] = "partial"
        validate("diagnostic", d)
        self.assertEqual(d["errors"][0]["message"], text)
        # B1 only checks data safety, not browser rendering. B3 must render with textContent.

    def test_expected_results_inventory(self):
        expected = load_fixture("expected-results.json")
        self.assertEqual(set(expected), {f"F{i:02d}" for i in range(1, 9)})
        self.assertEqual(expected["F05"]["expected_comparison"], "not_comparable")
        self.assertFalse(expected["F08"]["valid"])


class B1FixRegressionTests(unittest.TestCase):
    """Orchestrator-approved five B1 fixes; synthetic data and GitHub-hosted CI only."""

    def test_status_ok_rejects_failed_and_partial_components(self):
        for state in ("failed", "partial"):
            d = load_fixture("F01_diagnostic_windows_ok.json")
            next(x for x in d["components"] if x["component"] == "llmfit")["status"] = state
            with self.subTest(state=state), self.assertRaisesRegex(ContractError, "overall_status ok"):
                validate("diagnostic", d)

    def test_status_ok_rejects_failed_and_partial_engines(self):
        for state in ("failed", "partial"):
            d = load_fixture("F01_diagnostic_windows_ok.json")
            d["engines"][0]["status"] = state
            with self.subTest(state=state), self.assertRaises(ContractError):
                validate("diagnostic", d)

    def test_status_ok_rejects_structured_error(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["errors"] = [{"component": "llmfit", "code": "SYNTHETIC_ERROR",
                        "message": "Synthetic error", "retryable": False}]
        with self.assertRaises(ContractError):
            validate("diagnostic", d)

    def test_partial_hardware_survives_engine_failure(self):
        d = load_fixture("F02_diagnostic_llmfit_timeout.json")
        validate("diagnostic", d)
        self.assertEqual(d["overall_status"], "partial")
        self.assertEqual(d["hardware"]["ram"]["physical_total_bytes"], 17179869184)

    def test_offline_not_tested_optional_cloud_keeps_ok(self):
        d = load_fixture("F03_diagnostic_offline_site.json")
        validate("diagnostic", d)
        self.assertEqual(d["overall_status"], "ok")

    def test_cloud_failure_hardware_ok_means_partial_not_failed(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["overall_status"] = "partial"
        next(x for x in d["components"] if x["component"] == "cloud")["status"] = "failed"
        d["cloud_checks"][0]["probes"][0]["status"] = "failed"
        d["cloud_checks"][0]["probes"][0]["error_code"] = "SYNTHETIC_NO_NETWORK"
        d["cloud_checks"][0]["conclusion"] = "connection_failed"
        d["cloud_checks"][0]["probes"][1]["status"] = "not_tested"
        d["cloud_checks"][0]["probes"][1]["http_status"] = None
        d["errors"] = [{"component": "cloud", "code": "SYNTHETIC_NO_NETWORK",
                        "message": "Offline", "retryable": True}]
        validate("diagnostic", d)
        d["overall_status"] = "failed"
        with self.assertRaisesRegex(ContractError, "overall_status failed"):
            validate("diagnostic", d)

    def test_multi_engine_partial_component_not_strict_equal(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["overall_status"] = "partial"
        d["engines"] = [
            {"name": "llmfit/cpu", "version": "1.1.20", "status": "ok", "sha256": None},
            {"name": "llmfit/sycl", "version": "1.1.20", "status": "failed", "sha256": None},
        ]
        next(x for x in d["components"] if x["component"] == "llmfit")["status"] = "partial"
        validate("diagnostic", d)
        next(x for x in d["components"] if x["component"] == "llmfit")["status"] = "ok"
        with self.assertRaisesRegex(ContractError, "engine"):
            validate("diagnostic", d)

    def test_invalid_engine_mapping_and_skipped_parent(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["engines"][0]["name"] = "unmapped/cpu"
        with self.assertRaisesRegex(ContractError, "matching component"):
            validate("diagnostic", d)
        d = load_fixture("F01_diagnostic_windows_ok.json")
        next(x for x in d["components"] if x["component"] == "llmfit")["status"] = "skipped"
        with self.assertRaisesRegex(ContractError, "skipped component"):
            validate("diagnostic", d)

    def test_duplicate_engines_and_errors_reference(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["engines"].append(copy.deepcopy(d["engines"][0]))
        with self.assertRaisesRegex(ContractError, "duplicate engine"):
            validate("diagnostic", d)
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["errors"] = [{"component": "missing", "code": "SYNTHETIC",
                        "message": "Missing", "retryable": False}]
        d["overall_status"] = "partial"
        with self.assertRaisesRegex(ContractError, "missing component"):
            validate("diagnostic", d)

    def test_status_partial_needs_degradation_and_failed_needs_no_usable(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["overall_status"] = "partial"
        with self.assertRaisesRegex(ContractError, "partial requires"):
            validate("diagnostic", d)
        d["overall_status"] = "failed"
        with self.assertRaisesRegex(ContractError, "failed contradicts"):
            validate("diagnostic", d)

    def test_failed_all_attempted_components_has_no_success(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["model_assessments"] = []
        d["cloud_checks"] = []
        for comp in d["components"]:
            comp["status"] = "failed"
        d["engines"][0]["status"] = "failed"
        d["overall_status"] = "failed"
        validate("diagnostic", d)

    def test_catalog_missing_field_provenance_for_all_recommendation_fields(self):
        c = load_fixture("catalog_valid.json")
        model = c["models"][0]
        model["architecture"] = "example_arch"
        model["context_tokens"] = 8192
        artifact = model["artifacts"][0]
        artifact["revision"] = "revision-A"
        artifact["sha256"] = "a" * 64
        artifact["source_uri"] = "https://example.org/files/example.gguf"
        provenance = model["field_provenance"]
        source = next(iter(provenance.values()))[0]
        keys = ("architecture", "parameters", "context_tokens", "modalities",
                "artifacts[0].format", "artifacts[0].quantization",
                "artifacts[0].size_bytes", "artifacts[0].revision",
                "artifacts[0].sha256", "artifacts[0].source_uri")
        for key in keys:
            provenance[key] = [copy.deepcopy(source)]
        validate("catalog", c)
        for key in keys:
            with self.subTest(field=key):
                bad = copy.deepcopy(c)
                del bad["models"][0]["field_provenance"][key]
                with self.assertRaisesRegex(ContractError, "field_provenance"):
                    validate("catalog", bad)

    def test_catalog_nullable_optional_fields_no_fake_provenance(self):
        c = load_fixture("catalog_valid.json")
        model = c["models"][0]
        self.assertIsNone(model["architecture"])
        self.assertIsNone(model["context_tokens"])
        self.assertNotIn("architecture", model["field_provenance"])
        self.assertNotIn("context_tokens", model["field_provenance"])
        validate("catalog", c)
        model["field_provenance"]["architecture"] = [
            copy.deepcopy(model["field_provenance"]["parameters"][0])
        ]
        with self.assertRaises(ContractError):
            validate("catalog", c)

    def test_provenance_unknown_source_alias_and_stale_artifact_index(self):
        c = load_fixture("catalog_valid.json")
        c["models"][0]["field_provenance"]["parameters"][0]["source_id"] = "fabricated"
        with self.assertRaisesRegex(ContractError, "unknown provenance source"):
            validate("catalog", c)
        c = load_fixture("catalog_valid.json")
        c["models"][0]["aliases"] = [{"value": "local-alias", "source_id": "fabricated",
                                       "method": "local:lowercase"}]
        with self.assertRaisesRegex(ContractError, "alias has unknown"):
            validate("catalog", c)
        c["models"][0]["aliases"][0]["source_id"] = "fixture-official"
        validate("catalog", c)
        c["models"][0]["field_provenance"]["artifacts[2].format"] = [
            copy.deepcopy(c["models"][0]["field_provenance"]["parameters"][0])
        ]
        with self.assertRaises(ContractError):
            validate("catalog", c)

    def test_numeric_cross_language_vectors(self):
        vectors = load_fixture("numeric-vectors.json")
        self.assertEqual(vectors["profile"], "neurometr-json-numeric-0.1.0")
        for row in vectors["vectors"]:
            raw = ('{"number":' + row["input"] + '}').encode("utf-8")
            with self.subTest(number=row["input"]):
                if row["accept"]:
                    decoded = decode_bounded(raw, LIMIT_DIAGNOSTIC)
                    self.assertIn("number", decoded)
                else:
                    with self.assertRaises(ContractError):
                        decode_bounded(raw, LIMIT_DIAGNOSTIC)

    def test_nested_numeric_overflow_and_unsafe_int(self):
        for token in ("1e999", "-1e999", "1e-999", "9007199254740992",
                      "9007199254740992.0", "-9007199254740992"):
            raw = ('{"nested":[{"x":' + token + '}]}').encode()
            with self.subTest(token=token), self.assertRaises(ContractError):
                decode_bounded(raw, LIMIT_DIAGNOSTIC)
        for value in (9007199254740992, -9007199254740992,
                      float("inf"), float("-inf"), float("nan")):
            d = load_fixture("F01_diagnostic_windows_ok.json")
            d["hardware"]["ram"]["physical_total_bytes"] = value
            with self.assertRaises(ContractError):
                validate("diagnostic", d)

    def test_safe_integer_schema_limits(self):
        d = load_fixture("F01_diagnostic_windows_ok.json")
        d["hardware"]["ram"]["physical_total_bytes"] = 9007199254740991
        validate("diagnostic", d)
        d["hardware"]["ram"]["physical_total_bytes"] = 9007199254740992
        with self.assertRaises(ContractError):
            validate("diagnostic", d)

    def test_execution_rejects_mixed_nested_configurations(self):
        d = load_fixture("F05_diagnostic_cpu_vs_sycl.json")
        d["model_assessments"][0]["measurements"][0]["execution"]["device_path"] = "gpu_offload"
        with self.assertRaisesRegex(ContractError, "measurement execution"):
            validate("diagnostic", d)
        d = load_fixture("F05_diagnostic_cpu_vs_sycl.json")
        d["model_assessments"][1]["speed_estimate"]["execution"]["backend_id"] = "cpu"
        with self.assertRaisesRegex(ContractError, "speed estimate execution"):
            validate("diagnostic", d)
        d = load_fixture("F05_diagnostic_cpu_vs_sycl.json")
        d["model_assessments"][1]["speed_estimate"]["backend_id"] = "cpu"
        with self.assertRaisesRegex(ContractError, "speed estimate backend"):
            validate("diagnostic", d)

    def test_execution_equal_known_configurations_comparable_only_in_config(self):
        d = load_fixture("F05_diagnostic_cpu_vs_sycl.json")
        cpu, sycl = d["model_assessments"]
        self.assertEqual(comparison_status(sycl, cpu), "not_comparable")
        cpu["execution"] = copy.deepcopy(sycl["execution"])
        cpu["measurements"][0]["execution"] = copy.deepcopy(sycl["execution"])
        self.assertEqual(comparison_status(sycl, cpu), "not_comparable")  # unknown GPU layers
        cpu["execution"]["gpu_layers"] = 10
        cpu["measurements"][0]["execution"]["gpu_layers"] = 10
        sycl["execution"]["gpu_layers"] = 10
        sycl["speed_estimate"]["execution"]["gpu_layers"] = 10
        self.assertEqual(comparison_status(sycl, cpu), "comparable_configuration")
        validate("diagnostic", d)
        cpu["artifact_id"] = "gguf:other"
        self.assertEqual(comparison_status(sycl, cpu), "not_comparable")

    def test_override_f08_only_validates_unapplied_status(self):
        bad = load_fixture("F08_catalog_incompatible_override.json")
        self.assertEqual(bad["llmfit_overrides"][0]["status"], "applied")
        with self.assertRaises(ContractError):
            validate("catalog", bad)
        candidate = copy.deepcopy(bad)
        candidate["llmfit_overrides"][0]["status"] = "not_applied"
        validate("catalog", candidate)
        # ACCEPTED FORMAT IS NOT PROOF THAT CLI SUPPORTS proposed_value.
        candidate["llmfit_overrides"][0]["source_id"] = "unknown-source"
        with self.assertRaisesRegex(ContractError, "unknown provenance"):
            validate("catalog", candidate)
        candidate = copy.deepcopy(bad)
        candidate["llmfit_overrides"][0]["status"] = "not_applied"
        candidate["llmfit_overrides"].append(copy.deepcopy(candidate["llmfit_overrides"][0]))
        with self.assertRaisesRegex(ContractError, "duplicate llmfit"):
            validate("catalog", candidate)


if __name__ == "__main__":
    unittest.main()
