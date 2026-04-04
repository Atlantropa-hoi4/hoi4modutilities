# HOI4 RGB Picker Placement Todo

## Plan
- [x] Inspect the current RGB picker matching logic and identify why false-positive decorations can appear
- [x] Replace the loose text matching with parser-backed RGB node detection
- [x] Add regression coverage so only real parsed `color`/`color_ui` RGB nodes get picker ranges
- [x] Run verification and capture the placement-fix review notes

## Notes
- Scope is limited to preventing stray RGB picker decorations in the new country/ideology color support.
- Keep the same supported files and rewrite behavior; only tighten how picker ranges are discovered.
- Prefer parser-backed correctness over broader regex heuristics.

## Review
- `src/util/countryColorProviderShared.ts` no longer scans supported files with a broad regex for picker ranges. It now parses the HOI4 file and only emits matches for real `color` or `color_ui` nodes whose values are 3-component plain or `rgb` arrays, which removes stray decorations from color-like text that is not an actual parsed color definition.
- The shared rewrite/label behavior stayed the same, so supported country and ideology files still keep their existing `rgb { ... }` or `{ ... }` formatting when the picker writes back a new value.
- Added regression coverage in `test/unit/country-color-provider-shared.test.ts` so text like `debug_text = "color = { 99 98 97 }"` inside supported files does not produce an RGB picker range.
- Verification passed: `npm test` and `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.20.vsix`.
- Manual in-editor smoke testing of the corrected picker placement was not run in this terminal session.
