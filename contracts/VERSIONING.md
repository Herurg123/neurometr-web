# Contract versioning and compatibility

Owner: Neurometr orchestrator. Canonical location: \`neurometr-web/contracts/\`.

- Diagnostic schema, catalog schema, catalog-manifest schema, agent version, llmfit binary version and UI version are **independent**.
- Initial schema versions: \`0.1.0\`; catalog **snapshot** release ID proposed \`YYYY.MM.DD.N\`, not the same thing as JSON Schema version.
- In \`0.1.x\`, only textual/documentation or validator fixes preserving the **same accepted wire-data set and semantics** are allowed.
- Added/removed fields, changed types, enums, meanings, nullable handling or compatibility require an explicitly approved new minor (for example \`0.2.0\`) and linked PRs. Do **not** infer all pre-1.0 versions are compatible.
- Viewers accept only explicitly enumerated supported versions. An unknown version must fail closed with a clear error, not be silently adapted.
- Reports saved by Agent stay unchanged; optional in-memory projections are labeled with analysis/catalog versions.
- The Agent pin copy must record original Web commit SHA and exact SHA-256 per canonical file. A schema change needs coordinated PRs with independent regression tests, no automatic merge.
- A catalog snapshot with a later version does not change historical measurements or prove a new model's TPS, fit or runnable backend.
- Signed catalog rollback requires a **newer signed release manifest** and validated, explicitly selected older payload. Never silently downgrade the active trusted snapshot.

**Version matrix for B1**

| Artifact | Schema | Readers / writers |
|---|---|---|
| diagnostic.json | diagnostic 0.1.0 | Agent writes, Web reads |
| catalog.json | catalog 0.1.0 | Web pipeline writes, Agent/Web read |
| manifest.json | manifest 0.1.0 | Web pipeline writes, Agent verifies |
| latest.json | catalog-pointer 0.1.0 | Web publishes locator last, Agent fetches cautiously |

Production release keys, source licenses, browser support and complete Ed25519 verification remain unapproved/unimplemented; no remote updates are enabled in this contract-only PR.
