# B1 diagnostic status and execution invariants (v0.1.0 Draft)

All rules below are **semantic validation**, not a new wire field or a new mandatory diagnostic profile.

## Status aggregation

- A component reports `ok` when its attempted work succeeded, `partial` when it produced usable partial results, `failed` when attempted work failed, and `skipped` only when intentionally not executed.
- `overall_status=ok` requires at least one successful component, no `partial`/`failed` components or engines, and `errors=[]`. Intentionally skipped optional components are compatible with `ok`.
- `overall_status=partial` requires both (1) a usable `ok` or `partial` component and (2) an actual degradation: a `partial`/`failed` component or engine, or structured error.
- `overall_status=failed` means no component or engine reports `ok`/`partial`, and some attempt failed or produced a structured error. A record with every component skipped is not a valid successful diagnostic.
- Missing Internet connectivity alone must **not** make the whole run `failed` if hardware data remain usable. Requested failed cloud checks can yield `partial`; cloud checks not requested are represented by `cloud_checks=[]` and `cloud.status=skipped`.
- Each error `errors[].component` names an existing component and makes its status `partial` or `failed` (never `ok` or `skipped`).
- For engine-to-component matching without adding a wire field, an engine's `name` is `component` or `component/suffix`, e.g. `llmfit/cpu`, `llmfit/sycl`. The prefix must resolve to `components[].component`. Engine names must be unique.
- Any `failed`/`partial` engine disallows its parent component from being `ok` or `skipped`. A skipped component cannot contain attempted engines. An engine that succeeded does **not** require the parent to be `ok`: multiple engines may produce a legitimately `partial` parent.
- `cloud.status=skipped` requires `cloud_checks=[]`. A failed executed cloud probe cannot coexist with `cloud.status=ok` or `skipped`.

No strict equality of each engine status and component status is imposed. All status combinations remain independently subject to normal JSON Schema and evidence validation.

## Execution per assessment

One `model_assessments[]` entry represents **one model ID, artifact ID, context and execution configuration**. Top-level `execution` is normative for that assessment. If `speed_estimate` or a measurement exists, its nested `execution` must be **identical** to that assessment's top-level `execution`. The speed estimate's separate `backend_id` must also equal the execution backend (both nullable only if schema permits).

A single assessment cannot contain CPU-only measurements and GPU/SYCL estimates, even when source model names match. F05 therefore contains **two assessment entries**: CPU-only measured, GPU/SYCL estimated. They share the same known canonical model/artifact ID but have independent configurations. Neither source demonstrates a real GPU benchmark.

Comparability is a **derived Web analysis result, not a new wire field**. Mark `comparable_configuration` only when both assessments refer to the same non-null model ID and artifact ID and their relevant execution properties (backend, device path, runtime/version, layers, context and threads) are all known and equal. Otherwise the comparison is `not_comparable`. Even a comparable configuration does not imply identical benchmark methodology or validated error percentages.

`fit` remains distinct from `load_status`. `GPU detected` does not establish that a backend was launched, and `not_tested` is never silently treated as `failed`.
