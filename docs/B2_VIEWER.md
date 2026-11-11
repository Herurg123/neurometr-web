# B2 Static JSON Viewer

**Scope:** React 19 + TypeScript + Vite, static assets under `dist/`. No backend, telemetry, uploads, account system, remote catalog requests or production deploy.

## Data handling

- Browser `File` / `File.arrayBuffer()`; file length is checked at **2 MiB before reading**. UTF-8 decoded with fatal errors, BOM rejected.
- Custom strict lexical parser checks JSON syntax, duplicate keys (including escaped equivalents), maximum depth/nodes, safe integer and decimal precision policy from `contracts/NUMERIC_PROFILE.md`. Ordinary `JSON.parse` alone is not used for untrusted entire documents. JSON.parse only decodes validated string literals.
- Ajv2020 + ajv-formats validates the **unmodified canonical** `contracts/diagnostic.schema.json` (Draft 2020-12, 0.1.0).
- TypeScript semantic validator mirrors `contracts/STATUS_EXECUTION_INVARIANTS.md` including engine/component, cloud presence, outcome, measurement units, assessment execution identity. `cloud_checks` are never executed in the browser.
- View displays text with React escaping. No `dangerouslySetInnerHTML`, dynamic script evaluation, arbitrary JSON-sourced URLs, clipboard writes or network uploads. It does not mutate the original File.

## Fixture coverage

F01–F05 are valid diagnostic records, tested in Vitest and in real Chromium File API browser smoke. F06 is unsupported version and explicitly rejected. F07 and F08 are **catalog** fixtures, not diagnostics; viewer refuses their kinds. B2 does not verify manifest signatures or perform catalog activation; F07 bad-hash and F08 override compatibility require B4/Agent for actual end-to-end execution. Synthetic F01 is exposed via a clearly labeled demo button and screenshot.

## Development and review

GitHub Actions `.github/workflows/web-b2-ci.yml` performs npm dependency resolution, installation, TypeScript validation, Vitest, Vite static build, Playwright using the runner's installed Google Chrome (no browser download), screenshots and zipped artifacts. npm lockfile is generated in cloud CI during bootstrap and **must be committed in this feature branch before merge**.

Production deployment remains blocked, no GitHub Release. Browser testing does not replace a real Windows Agent → file → viewer integration smoke test.
