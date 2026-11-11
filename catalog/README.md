# B3.1 Base offline catalog: immutable candidate 2026.11.11.2

**Status: Draft PR, not merged or approved for Agent packaging.** No remote updates, production signatures, uploads, model weights or deployments. This snapshot contains verified *metadata* for two GGUF artifacts from the model publisher Qwen.

- `catalog/versions/2026.11.11.2/catalog.json`: candidate canonical `neurometr.catalog`, JSON Schema Draft 2020-12, schema_version `0.1.0`.
- `catalog/research/2026.11.11.2-evidence.json`: source audit, pinned Hugging Face revision, artifact metadata and license evidence.
- `llmfit_overrides=[]`; no locally tested TPS, RAM fit, inference or GPU claim.
- Exact model parameters cannot be obtained from rounded "0.49B/1.54B" in publisher cards; represent as `null`.
- Apache-2.0 applies to both upstream repositories. Redistributing **their model files** would require proper license and notice attribution. This PR does not redistribute weights.
- The future manifest is **unsigned draft metadata only**, so it must not be treated as an authenticated catalog update. For offline Agent PoC pin the catalog **file bytes** to an approved Web commit SHA + SHA-256; **do not** enable remote update.
- CI exclusively runs on GitHub-hosted runners, validates catalog/manifest, and produces reproducible byte counts/hashes. No owner-local developer setup.

The official upstream source evidence is reproducible without downloading model weights: see `scripts/catalog_probe.py` and its [one-time research run](https://github.com/Herurg123/neurometr-web/actions/runs/43085744751). Do not infer model compatibility with pinned llmfit from the model file being present on Hugging Face.
