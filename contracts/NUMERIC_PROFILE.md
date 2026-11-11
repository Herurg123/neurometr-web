# Portable JSON numeric profile v0.1.0 Draft

This normative parsing profile applies **before** Draft 2020-12 schema and semantic checks to diagnostic, catalog, manifest and latest pointer JSON.

1. Raw input is bounded and strictly decoded as UTF-8 JSON with no duplicate keys.
2. The tokens `NaN`, `Infinity`, `-Infinity` are forbidden. An exponent such as `1e999` must be rejected; do not allow a parser to turn it into infinity.
3. Every JSON integer (including integral exponent/decimal notation such as `9007199254740992.0`) must be within the JavaScript safe-integer interval **[-9007199254740991, +9007199254740991]**. Individual nonnegative field constraints still apply.
4. Floating numbers must be finite and preserve their shortest-roundtrip decimal meaning when converted to IEEE-754 binary64: compare original decimal rational to the decimal produced from a shortest-roundtrip representation. If conversion silently underflows to zero or rounds away user-supplied decimal significance, reject it rather than claim that it was parsed unchanged.
5. Negative zero is permitted as a JSON numeric value but does not mean unknown. `null` alone expresses unavailable numerical data.
6. Any failure is a controlled input-validation error. No automatic clamping, truncation, inference or conversion to `null`.

**Implementer guidance:** Python may use `decimal.Decimal` in `json.loads(parse_float=...)` and `parse_int` hooks, and must reject any non-finite/beyond-range result before converting to `float`; `jsonschema` alone is insufficient. Go should use `json.Decoder.UseNumber()` and parse original number tokens with precision/range checks before converting to `float64` or signed integer. TypeScript should lexically inspect JSON numeric tokens **before** ordinary `JSON.parse` because JSON.parse already loses overflow/precision information, then use Ajv2020 for the JSON Schema. All runtimes must reject duplicate keys and unsafe representations rather than rely only on a default JSON parser.

Cross-language fixtures: `fixtures/numeric-vectors.json`; `accept` means numerical parsing succeeds, not necessarily schema acceptance in a particular field. These vectors are the minimum shared behavior; later Go/TypeScript implementations must run against exactly the same corpus.

Numeric measurements and estimates still need independent evidence and unit validation; this profile does not turn a predicted TPS into a measured TPS.
