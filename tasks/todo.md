# HOI4 Mod Utilities Localisation Highlighting Todo

## Plan
- [x] Add localisation-specific editor decoration support for HOI4 `.yml` files
- [x] Render `§` color codes in their own HOI4 colors and tint the affected text spans
- [x] Highlight inline localisation code tokens such as `£texticon`, `$references$`, and `[scripted_loc]`
- [x] Add targeted unit tests for localisation token parsing and string-range extraction
- [x] Verify with `npm run compile-ts`, `npm run lint`, and `npm test`

## Notes
- Use the referenced extension as behavior guidance, but adapt the implementation to this repository's existing extension architecture.
- Prefer a lightweight runtime decoration path over a large language/grammar migration unless the codebase clearly requires grammar contributions.
- Keep the feature scoped to HOI4 localisation `.yml` content and avoid changing existing preview or index behavior.

## Review
- Implemented:
  - added a localisation-highlighting decorator service that activates for HOI4 `.yml` localisation files and refreshes across visible editors
  - render `§` color codes with HOI4 palette colors and tint the text span that remains active until the next color code or reset
  - highlight inline localisation control tokens for `£texticon`, `$references$`, and `[scripted_loc]` separately from surrounding colored text
  - wired the feature into extension activation and enabled activation when plaintext or YAML editors open
  - added fixture-backed unit tests for localisation detection, quoted-string extraction, and decoration token extraction
- Verification:
  - `npm run compile-ts`: passed
  - `npm run lint`: passed
  - `npm test`: passed
  - `npm run package`: passed and produced `hoi4modutilities-0.13.0.vsix`
- Notes:
  - temporary reference folders cloned from the external repository were removed before packaging so they do not ship in the VSIX
