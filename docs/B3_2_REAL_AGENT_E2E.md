# B3.2 — Real Agent → browser File API E2E

Web-only Draft PR; Agent, canonical contracts, fixtures F01–F08 and bundled catalog read-only.

## Pinned sources
- Agent source: f63d38fa8018572f570d60f6bf652ee2bb7e64c3; Web base: bb828bb09372e16cf63d04371d5f9367eee2526e.
- Bundled catalog version 2026.11.11.2, 6589 bytes, SHA-256 1d84ff596c589a4db004f8a3fa17490d5479f57db3d7b0a433a7e448289651d2; normal export only, never test-only mode.

## Confidential Windows job
- Isolated GitHub Windows 2025 runner checks exact Agent checkout HEAD and bundled catalog bytes against the Web catalog. Builds native Go commands in RUNNER_TEMP, invokes ordinary diagnose with -root and -output only. No llmfit, no heavy benchmarks, no model weights.
- Private diagnostic.json is created outside Git checkout. Agent full Go validator and independent canonical Web Python validator both check the actual bytes. No raw JSON, CPU/GPU model, RAM amount, username, path, stack traces or subprocess stderr are printed or uploaded.
- Same runner uses Playwright Chromium (Chrome or Edge) and native browser input[type=file] to open that exact file in locally served static Vite preview on 127.0.0.1:4179.
- Page network requests are monitored with browser-context routing: only loopback GET/HEAD to Vite is permitted; all other requests fail the test. No backend or upload. This tests browser page-observable traffic; no unsupported claim about all Chrome background network traffic.
- Private E2E deliberately uses Playwright API rather than the Playwright test runner, preventing automatic reporter error-context DOM snapshots. No screenshots, trace or video; all failure output is redacted. Windows job has no upload-artifact action. A final if: always() step deletes JSON and temporary Go binaries.

## Browser acceptance
- Imported report must have diagnostic schema v0.1.0, bundled catalog version/hash, producer Windows x64 and no TEST ONLY.
- UI must show native OS, CPU, RAM and GPU data. Unmeasured dedicated/free/shared VRAM remains labelled unknown (not 0). Unimplemented NPU detection is not presented as no-NPU evidence.
- Optional llmfit skipped; no executed runtime, TPS, model assessments, or cloud checks; two Qwen catalog entries do not imply inference. Empty assessment message distinguishes zero assessments from an empty catalog.
- Limitations remain visible, partial hardware is preserved. No external browser requests or posts after import.

## Other CI coverage
- Linux job: 44 contract tests, 16 catalog tests, TypeScript typecheck, Vitest, Vite build and synthetic-only Playwright regressions.
- Added synthetic browser negatives for hardware partial, optional llmfit error, unknown VRAM, malformed/duplicate JSON, wrong kind, oversize, and unsigned manifest. Existing F01–F08 and XSS tests remain intact.

Not checked: user PC, real llmfit execution, inference, GPU/SYCL performance, NPU hardware detection, signed remote catalogs, systemwide packet capture, deployment.
