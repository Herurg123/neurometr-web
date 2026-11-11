# Neurometr canonical contracts

**Status:** B1 implementation for orchestrator review; PR only, not merged and not an authorization to publish.
**Baseline:** K-01–K-04 approved 2026-11-11. Version **0.1.0**, JSON Schema **Draft 2020-12**.

## Source of truth

This repository owns normalized wire formats under `contracts/`. Agent produces `diagnostic` and consumes `catalog`; Web consumes `diagnostic` and produces `catalog`/manifest. Agent must hold an **exact SHA-256 pin copy** of approved schemas/fixtures with originating Web commit in `neurometr-agent/contracts/contract.lock.json`. This PR does not change Agent. Linked Agent PR, orchestrator review, and contract compatibility tests are prerequisites to merge.

- `diagnostic.schema.json` validates normalized diagnostic reports. No device serial, MAC, IP, machine GUID, username, user content, credentials or raw llmfit stdout by default.
- `catalog.schema.json` validates immutable model metadata, concrete artifacts and field-level provenance. User benchmarks do **not** belong in the global model catalog.
- `catalog-manifest.schema.json` validates immutable release metadata, lengths and hashes.
- `latest-pointer.schema.json` and `latest-pointer.md` specify the **untrusted** `latest.json` locator.
- `fixtures/` contains synthetic F01–F08 and expected outcomes. Numeric F05 example is illustrative based on E4, not new measured evidence.

## Evidence, results and units

`evidence.kind`: `detected | estimated | measured | user_reported | derived | unknown`.
Subsystem `status`: `ok | partial | failed | skipped`.
Check `status`: `passed | failed | indeterminate | not_tested | unsupported`.

`fit` is a memory estimate, never proof of successful load. `load_status`, runtime discovery and backend launch are independent. `null` means unknown; never substitute `0`. Memory uses integer bytes, speed tokens/s, latency ms, time UTC with `Z`, model context tokens. Shared and unified GPU memory must not be double-counted with system RAM.

A CPU-only measured TPS is **not comparable** to an estimate for a different GPU/SYCL execution. Unknown model or unsupported computational algorithm remains `not_calculated` in analysis (a UI outcome, not an invented numeric field). HTTP 401/403 are not regional blocking evidence.

## Layered validation (B1)

1. Check byte budgets before parsing: diagnostic ≤ **2 MiB**, catalog ≤ **20 MiB**.
2. UTF-8 JSON parse with duplicate-key and non-finite number rejection and depth/node budget.
3. Reject unsupported `schema_version` explicitly.
4. Run Draft 2020-12 validation including formats.
5. Semantic checks: times, unique IDs, evidence/units, provenance references, relative paths, matching catalog release versions.
6. Signed-update verification and fallback are **future B4/Agent features**, not implemented by JSON Schema.

B1 Python `unittest` + `jsonschema` runs solely in GitHub Actions. B2 React viewer can use Ajv2020 for the same normative schemas; the tests do not depend on a local Node development environment. Test/runtime dependencies are installed on ephemeral GitHub-hosted runners.

**Security note:** F07 currently checks mismatched hash/size and missing trust flag only. It is **not** a cryptographic Ed25519 verifier; a test-signature vector and real signature/rollback verification belong to B4. This must not be presented as secure production catalog activation. No remote fetch, arbitrary URL invocation, code execution or production keys exist in B1.

## Fixtures

| ID | Expected contract result | Later end-to-end responsibility |
|---|---|---|
| F01 | valid normal Windows diagnostic | Web B2 |
| F02 | valid partial report with llmfit timeout | Web B3 + Agent |
| F03 | valid bundled/offline reference | Agent offline history + B7 |
| F04 | valid nullable iGPU/shared memory and NPU unknown | Web B3 |
| F05 | valid separated CPU measured / SYCL estimated | Web B3 must show `not_comparable` |
| F06 | unsupported `9.9.9` rejected | Web B3 |
| F07 | valid catalog but bad manifest digest/size; cannot activate | Web B4 + Agent |
| F08 | incompatible `applied` llmfit override rejected | Web B4 + Agent CLI PoC |

The corpus is synthetic. All fixture examples are immutable once accepted for a contract revision.

## Run in CI

`.github/workflows/contract-ci.yml` runs for pull requests and manual dispatch. Commands execute in GitHub-hosted runners, **not on the owner's computer**. Workflow requires read-only repo permissions and has no secrets/deploy.

## Open review items

Specific optional field definitions, known future use cases, targeted browser compatibility, safe override whitelist after pinned llmfit CLI PoC, hosted Ed25519 release-key policy, production catalog source licensing and cloud allowlist must be reviewed by the orchestrator. A `0.1.x` patch cannot silently change these wire structures.

## B1 Fix: orchestrator-reviewed semantic invariants (still Draft)

- [Status and per-assessment execution](STATUS_EXECUTION_INVARIANTS.md): aggregate results are consistent and F05 CPU measured/SYCL estimated are distinct assessments.
- [Catalog provenance rules](PROVENANCE_RULES.md): existing field_provenance paths cover every populated recommendation-relevant attribute.
- [Portable JSON numeric profile](NUMERIC_PROFILE.md): safe integers, overflow and precision validation across planned Go/Python/TypeScript implementations.
- F08 **currently tests schema/status rejection only**. The existence of "not_applied" overrides does NOT mean pinned llmfit CLI accepts any proposed field or custom model. Field whitelist and actual effect on fit/ranking require independent Agent CLI PoC.
- All five B1 fixes are inside PR #1, schema_version is 0.1.0 Draft and must not be considered frozen until orchestrator sign-off.
