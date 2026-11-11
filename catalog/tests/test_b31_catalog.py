"""B3.1 tests: canonical schema, signedness boundary, metadata audit and negative cases.
No network, weights, private key, deploy or Agent write.
"""
from __future__ import annotations
import copy
import hashlib
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "contracts" / "tests"))
from test_contracts import ContractError, LIMIT_CATALOG, decode_bounded, validate, load_fixture

VERSION = "2026.11.11.2"
C = ROOT / "catalog" / "versions" / VERSION / "catalog.json"
M = ROOT / "catalog" / "manifests" / VERSION / "manifest.json"
E = ROOT / "catalog" / "research" / (VERSION + "-evidence.json")
EXPECTED_SIZE = 6589
EXPECTED_SHA = "1d84ff596c589a4db004f8a3fa17490d5479f57db3d7b0a433a7e448289651d2"

def validate_offline_bytes(manifest, raw):
    """Checks integrity/format, NOT Ed25519 authenticity or remote publication."""
    validate("manifest", manifest)
    if len(manifest["artifacts"]) != 1:
        raise ContractError("expected one catalog payload")
    meta = manifest["artifacts"][0]
    if meta["bytes"] != len(raw):
        raise ContractError("catalog byte length mismatch")
    if meta["sha256"] != hashlib.sha256(raw).hexdigest():
        raise ContractError("catalog sha256 mismatch")
    doc = decode_bounded(raw, LIMIT_CATALOG)
    validate("catalog", doc)
    if doc["catalog_version"] != manifest["catalog_version"]:
        raise ContractError("catalog version mismatch")
    if doc["schema_version"] != manifest["catalog_schema_version"]:
        raise ContractError("catalog schema mismatch")
    return doc

def verify_audited_sources(catalog, audit):
    if audit["catalog_version"] != catalog["catalog_version"]:
        raise ContractError("audit version mismatch")
    by_source = {x["source_id"]: x for x in catalog["source_snapshots"]}
    by_model = {x["model_id"]: x for x in catalog["models"]}
    if len(audit["entries"]) != len(by_model):
        raise ContractError("audit model count mismatch")
    for row in audit["entries"]:
        sid, revision = row["source_id"], row["upstream_revision"]
        if not re.fullmatch(r"[a-f0-9]{40}", revision):
            raise ContractError("bad pinned source revision")
        if sid not in by_source or row["model_id"] not in by_model:
            raise ContractError("missing audited model/source")
        source, model = by_source[sid], by_model[row["model_id"]]
        if source["revision"] != revision or source["fetched_at"] != row["fetched_at"]:
            raise ContractError("unpinned source revision")
        if source["url"] != f"https://huggingface.co/{row['repo']}/tree/{revision}":
            raise ContractError("source URI not pinned")
        if source["license_status"] != "verified" or row["license_status"] != "verified":
            raise ContractError("license evidence not verified")
        if row["license_expression"] != "Apache-2.0":
            raise ContractError("license expression mismatch")
        if model["parameters"] is not None or model["architecture"] != "qwen2":
            raise ContractError("unsupported model parameter/architecture claim")
        if model["context_tokens"] != 32768 or model["modalities"] != ["text"]:
            raise ContractError("model metadata differs from publisher card")
        if not row["context_32768_confirmed_in_card"] or not row["quant_Q4_K_M_confirmed_in_card"]:
            raise ContractError("metadata not confirmed in publisher card")
        if len(model["artifacts"]) != 1:
            raise ContractError("artifact count mismatch")
        a = model["artifacts"][0]
        sha = row["upstream_artifact_sha256"]
        if not re.fullmatch(r"[a-f0-9]{64}", sha):
            raise ContractError("bad upstream sha")
        if a["artifact_id"] != "gguf:sha256:" + sha:
            raise ContractError("artifact identity mismatch")
        if a["sha256"] != sha or a["size_bytes"] != row["upstream_artifact_bytes"]:
            raise ContractError("upstream artifact metadata mismatch")
        if a["revision"] != revision or a["format"] != "gguf" or a["quantization"] != "Q4_K_M":
            raise ContractError("artifact revision/format/quant mismatch")
        if a["source_uri"] != row["artifact_page_url"].replace("/blob/", "/resolve/"):
            raise ContractError("artifact URI not pinned")
        for field, records in model["field_provenance"].items():
            if not records or any(
                r["source_id"] != sid or r["evidence_level"] != "official_metadata" or
                r["observed_at"] != row["fetched_at"]
                for r in records
            ):
                raise ContractError("field provenance mismatch: " + field)
    if catalog["llmfit_overrides"] != []:
        raise ContractError("No verified llmfit override in B3.1")

class B31OfflineCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = C.read_bytes()
        cls.catalog = decode_bounded(cls.raw, LIMIT_CATALOG)
        cls.manifest = json.loads(M.read_text(encoding="utf-8"))
        cls.audit = json.loads(E.read_text(encoding="utf-8"))

    def test_canonical_catalog_and_semantic_validation(self):
        validate("catalog", self.catalog)
        self.assertEqual(self.catalog["kind"], "neurometr.catalog")
        self.assertEqual(self.catalog["schema_version"], "0.1.0")
        self.assertEqual(self.catalog["catalog_version"], VERSION)
        self.assertEqual(len(self.catalog["models"]), 2)

    def test_manifest_schema_diagnostic_v010_compatibility(self):
        validate("manifest", self.manifest)
        self.assertEqual(self.manifest["compatible_diagnostic_schema_versions"], ["0.1.0"])
        self.assertEqual(self.manifest["min_agent_version"], "0.1.0")
        validate("diagnostic", load_fixture("F01_diagnostic_windows_ok.json"))

    def test_exact_snapshot_bytes_sha256_and_manifest(self):
        self.assertEqual(len(self.raw), EXPECTED_SIZE)
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(), EXPECTED_SHA)
        self.assertEqual(validate_offline_bytes(self.manifest, self.raw), self.catalog)

    def test_verifiable_official_pinned_sources_and_field_provenance(self):
        verify_audited_sources(self.catalog, self.audit)
        self.assertEqual(len(self.catalog["source_snapshots"]), 2)

    def test_license_evidence_and_no_weight_distribution(self):
        self.assertIn("Apache-2.0", self.audit["licenses"])
        for entry in self.audit["entries"]:
            self.assertTrue(entry["license_url"].startswith("https://huggingface.co/Qwen/"))
            self.assertEqual(entry["evidence_level"], "official_metadata")
            self.assertEqual(entry["license_status"], "verified")

    def test_null_parameters_no_guesses_or_benchmark(self):
        self.assertEqual(self.catalog["llmfit_overrides"], [])
        for model in self.catalog["models"]:
            self.assertIsNone(model["parameters"])
            self.assertNotIn("parameters", model["field_provenance"])
            self.assertEqual(model["aliases"], [])
            self.assertNotIn("speed_estimate", model)
            self.assertNotIn("measurements", model)
        self.assertNotIn("synthetic:fixture", self.raw.decode("utf-8"))

    def test_draft_unsigned_manifest_not_a_trusted_remote_release(self):
        self.assertEqual(self.manifest["signing_key_id"], "offline-unsigned-no-key")
        self.assertFalse((M.parent / "manifest.json.sig").exists())
        self.assertFalse((ROOT / "catalog" / "latest.json").exists())

    def test_corrupted_json_rejected(self):
        with self.assertRaises(ContractError):
            decode_bounded(self.raw.rstrip()[:-1], LIMIT_CATALOG)

    def test_corrupted_payload_checksum_rejected(self):
        altered = self.raw.replace(b'"qwen2"', b'"other"', 1)
        self.assertNotEqual(altered, self.raw)
        with self.assertRaisesRegex(ContractError, "sha256"):
            validate_offline_bytes(self.manifest, altered)

    def test_wrong_catalog_schema_version_rejected(self):
        c = copy.deepcopy(self.catalog)
        c["schema_version"] = "9.9.9"
        with self.assertRaisesRegex(ContractError, "unsupported schema version"):
            validate("catalog", c)

    def test_wrong_manifest_version_and_diagnostic_compatibility_rejected(self):
        m = copy.deepcopy(self.manifest)
        m["catalog_schema_version"] = "9.9.9"
        with self.assertRaises(ContractError):
            validate("manifest", m)
        m = copy.deepcopy(self.manifest)
        m["compatible_diagnostic_schema_versions"] = ["9.9.9"]
        with self.assertRaises(ContractError):
            validate("manifest", m)

    def test_bad_size_and_sha256_rejected(self):
        m = copy.deepcopy(self.manifest)
        m["artifacts"][0]["bytes"] += 1
        with self.assertRaisesRegex(ContractError, "byte length"):
            validate_offline_bytes(m, self.raw)
        m = copy.deepcopy(self.manifest)
        m["artifacts"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ContractError, "sha256"):
            validate_offline_bytes(m, self.raw)

    def test_path_traversal_and_wrong_versioned_path_rejected(self):
        m = copy.deepcopy(self.manifest)
        m["artifacts"][0]["path"] = "../../etc/passwd"
        with self.assertRaises(ContractError):
            validate("manifest", m)
        m = copy.deepcopy(self.manifest)
        m["artifacts"][0]["path"] = "/data/catalog/versions/2026.11.11.1/catalog.json"
        with self.assertRaises(ContractError):
            validate("manifest", m)

    def test_missing_provenance_and_unresolved_sources_rejected(self):
        c = copy.deepcopy(self.catalog)
        del c["models"][0]["field_provenance"]["artifacts[0].sha256"]
        with self.assertRaisesRegex(ContractError, "field_provenance"):
            validate("catalog", c)
        c = copy.deepcopy(self.catalog)
        c["models"][0]["field_provenance"]["artifacts[0].format"][0]["source_id"] = "fake"
        with self.assertRaisesRegex(ContractError, "unknown provenance"):
            validate("catalog", c)

    def test_metadata_tamper_detected_even_if_schema_valid(self):
        c = copy.deepcopy(self.catalog)
        c["models"][0]["artifacts"][0]["size_bytes"] += 1
        validate("catalog", c)
        with self.assertRaisesRegex(ContractError, "upstream artifact metadata mismatch"):
            verify_audited_sources(c, self.audit)
        c = copy.deepcopy(self.catalog)
        c["models"][0]["artifacts"][0]["artifact_id"] = "fake-artifact"
        validate("catalog", c)
        with self.assertRaisesRegex(ContractError, "artifact identity mismatch"):
            verify_audited_sources(c, self.audit)

    def test_no_pii_or_secret_fields_and_catalog_size_limit(self):
        self.assertLessEqual(len(self.raw), LIMIT_CATALOG)
        banned = {"api_key", "access_token", "password", "secret", "serial_number",
                  "username", "mac_address", "ip_address", "private_key"}
        queue = [self.catalog]
        while queue:
            item = queue.pop()
            if isinstance(item, dict):
                self.assertTrue(banned.isdisjoint(item.keys()))
                queue.extend(item.values())
            elif isinstance(item, list):
                queue.extend(item)

if __name__ == "__main__":
    unittest.main()
