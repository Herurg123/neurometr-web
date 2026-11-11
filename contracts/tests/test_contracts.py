"""B1 contract checks. Synthetic fixtures only; no external API, network or signature keys."""
import copy
from datetime import datetime
import hashlib
import json
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


def decode_bounded(raw: bytes, limit: int):
    """Import boundary: bytes first, then strict JSON, then structural budget."""
    if len(raw) > limit:
        raise ContractError("input size limit exceeded")
    try:
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys, parse_constant=_nonfinite)
    except (UnicodeError, json.JSONDecodeError) as exc:
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
    return data


def load_fixture(filename: str):
    return decode_bounded((FIXTURES / filename).read_bytes(), LIMIT_CATALOG)


def validate(kind: str, data: dict):
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
    if data["errors"] and data["overall_status"] == "ok":
        raise ContractError("errors with overall_status ok")
    names = [x["component"] for x in data["components"]]
    if len(names) != len(set(names)):
        raise ContractError("duplicate component name")
    indices = [x["index"] for x in data["hardware"]["gpus"]]
    if len(indices) != len(set(indices)):
        raise ContractError("duplicate GPU index")
    for assessment in data["model_assessments"]:
        for measurement in assessment["measurements"]:
            expected_unit = {
                "generation_tps": "tokens/s",
                "prompt_tps": "tokens/s",
                "ttft_ms": "ms",
                "total_latency_ms": "ms",
                "peak_working_set_bytes": "bytes",
            }[measurement["kind"]]
            if measurement["unit"] != expected_unit:
                raise ContractError("measurement kind/unit mismatch")
    # Semantic rendering of a remote 401/403 must never claim regional blocking.
    # No "region_blocked" conclusion exists in the wire contract.
    for cloud in data["cloud_checks"]:
        if any(p["http_status"] == 401 for p in cloud["probes"]):
            if cloud["conclusion"] == "connection_failed":
                raise ContractError("HTTP 401 was misclassified as connection failure")


def comparison_status(assessment, measurement):
    estimate = assessment.get("speed_estimate")
    if estimate is None:
        return "not_comparable"
    if measurement["kind"] != "generation_tps":
        return "not_comparable"
    a = estimate["execution"]
    b = measurement["execution"]
    keys = ("device_path", "backend_id", "runtime_id", "runtime_version",
            "context_tokens", "threads", "gpu_layers")
    return "comparable_configuration" if all(a.get(k) == b.get(k) for k in keys) else "not_comparable"


def semantic_catalog(data):
    source_ids = [s["source_id"] for s in data["source_snapshots"]]
    if len(source_ids) != len(set(source_ids)):
        raise ContractError("duplicate catalog source_id")
    models = [m["model_id"] for m in data["models"]]
    if len(models) != len(set(models)):
        raise ContractError("duplicate model_id")
    artifact_ids = []
    for model in data["models"]:
        artifact_ids.extend(a["artifact_id"] for a in model["artifacts"])
        provenance = model["field_provenance"]
        if model["parameters"] is not None and "parameters" not in provenance:
            raise ContractError("parameters missing field_provenance")
        if model["modalities"] and "modalities" not in provenance:
            raise ContractError("modalities missing field_provenance")
        for i, artifact in enumerate(model["artifacts"]):
            if artifact["size_bytes"] is not None:
                if f"artifacts[{i}].size_bytes" not in provenance:
                    raise ContractError("artifact size missing field_provenance")
        for records in provenance.values():
            for record in records:
                if record["source_id"] not in source_ids:
                    raise ContractError("unknown provenance source")
    if len(artifact_ids) != len(set(artifact_ids)):
        raise ContractError("duplicate artifact_id")
    for override in data["llmfit_overrides"]:
        if override["target_model_id"] not in models:
            raise ContractError("override references unknown model")
        if override["source_id"] not in source_ids:
            raise ContractError("override has unknown provenance")
        if override["status"] != "not_applied":
            raise ContractError("llmfit override has not passed CLI PoC")


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
        a = load_fixture("F05_diagnostic_cpu_vs_sycl.json")["model_assessments"][0]
        self.assertEqual(a["speed_estimate"]["evidence"]["kind"], "estimated")
        self.assertEqual(a["measurements"][0]["evidence"]["kind"], "measured")
        self.assertEqual(comparison_status(a, a["measurements"][0]), "not_comparable")

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
        d["model_assessments"][0]["speed_estimate"]["evidence"]["kind"] = "measured"
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
        validate("diagnostic", d)
        self.assertEqual(d["errors"][0]["message"], text)
        # B1 only checks data safety, not browser rendering. B3 must render with textContent.

    def test_expected_results_inventory(self):
        expected = load_fixture("expected-results.json")
        self.assertEqual(set(expected), {f"F{i:02d}" for i in range(1, 9)})
        self.assertEqual(expected["F05"]["expected_comparison"], "not_comparable")
        self.assertFalse(expected["F08"]["valid"])


if __name__ == "__main__":
    unittest.main()
