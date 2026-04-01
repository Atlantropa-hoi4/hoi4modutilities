# HOI4 Mod Utilities Runtime Regression Todo

## Plan
- [x] Re-check the unresolved localisation highlighting and focus preview button regressions against the current forked manifest/runtime identifiers
- [x] Restore reliable activation for HOI4/paradox language documents and simplify the preview button visibility rules so supported files surface the command again
- [x] Bump the extension version so VSIX replacement is unambiguous during reinstall
- [x] Verify with `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`

## Notes
- The previous runtime-identifier split was necessary for side-by-side installation, but it did not fully resolve the user-visible regression.
- Focus preview visibility and localisation highlighting both depend on extension activation timing, so language activation events are part of the investigation.
- Favor a robust preview button over a too-strict toolbar `when` clause if the current condition keeps hiding the command on valid files.

## Review
- Implemented:
  - added `onLanguage:hoi4` and `onLanguage:paradox` activation events so the fork still initializes when a companion Paradox syntax extension changes the editor language mode
  - relaxed the preview command visibility rules in `package.json` so the toolbar and command palette can surface the preview action again on HOI4 script editors instead of depending too tightly on warmed-up runtime contexts
  - bumped the packaged extension version from `0.13.0` to `0.13.1` and documented the runtime regression fix in `CHANGELOG.md`
  - added a manifest regression test to keep the extra activation events and preview visibility rule from silently disappearing in future edits
- Verification:
  - `npm run compile-ts`: passed
  - `npm run lint`: passed
  - `npm test`: passed
  - `npm run package`: passed and produced `hoi4modutilities-0.13.1.vsix`
