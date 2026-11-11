# Catalog field-level provenance, v0.1.0 Draft

These are semantic invariants for the existing `model.field_provenance` map. No new wire properties are introduced.

## Canonical field-path grammar

Paths are **relative to each model**, not JSON Pointers:

- Scalar fields: `architecture`, `parameters`, `context_tokens`, `modalities`.
- Artifact fields: `artifacts[0].format`, `artifacts[0].quantization`, `artifacts[0].size_bytes`, `artifacts[0].revision`, `artifacts[0].sha256`, `artifacts[0].source_uri`, etc., with a **zero-based** decimal array index and no leading zeros.
- Every present non-null model scalar used for recommendations and every present non-null artifact metadata field must have a non-empty corresponding evidence array.
- `modalities=[]` asserts no confirmed modalities, so no provenance required; a non-empty array does require provenance.
- Unknown `null` values must **not** generate fictional evidence. Missing optional `source_uri` requires no provenance.
- Each record's `source_id` must resolve to an existing `source_snapshots[].source_id`. Empty arrays, unresolved sources, invented paths and references to non-existent artifact indices are rejected.
- The evidence record's `observed_at` and `evidence_level` do not themselves make the source correct; independent source quality is handled in the later catalog pipeline.

## Derived identities

Canonical `model_id` derives deterministically from source namespace and unambiguous source model identity, not name similarity. `artifact_id` derives from the actual artifact identity/quant/revision (not an unrelated model's file). Both are **derived local identifiers**; requiring a fabricated external source record for the derivation is forbidden. Their real source identity, matching rule and collisions belong to catalog-generation lineage tests. Neither identifier's presence alone guarantees correctness.

For `aliases[]`, each `value` must have a non-empty `source_id` and explicit `method`. The `source_id` resolves to an actual source snapshot. A locally normalized alias may refer to the **real originating source** with a method explaining the transformation; do not invent a fake external publisher. An empty aliases array is valid.

## Excluded from B1

Live source acquisition, license verification, conflict-resolution policy, identity matching against Hugging Face/llmfit and override effectiveness. Those need later source data and pinned Agent CLI tests.
