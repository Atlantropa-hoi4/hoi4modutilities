# HOI4 Mod Utilities Continuous Focus Position Edit Todo

## Plan
- [x] Inspect the current `continuous_focus_position` parse/render path and reuse the existing focus-edit message flow where possible
- [x] Extend focustree metadata/types so continuous focus positions keep writable source ranges and tree ownership info
- [x] Add host-side continuous position writeback helpers for replace-or-insert behavior with BOM-safe ranges
- [x] Wire a dedicated `applyContinuousFocusPositionEdit` message through the focus preview host and optimistic webview refresh path
- [x] Add edit-mode drag handling for `#continuousFocuses` without regressing blank-canvas pan, create, marquee, minimap, or relation editing
- [x] Keep `Jump to continuous` and minimap navigation synchronized with the updated continuous position source of truth
- [x] Add regression coverage for continuous position text changes and minimap model support
- [x] Update the existing `0.13.20` release notes for the new continuous edit capability
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and verification notes

## Notes
- Scope for this pass is `continuous_focus_position` editing only; no numeric HUD, reset action, or unrelated parser changes.
- Continuous position writeback must stay in absolute preview coordinates, not focus grid cell coordinates.
- Imported/shared/joint trees remain read-only for continuous editing; only the current document's top-level `focus_tree` continuous block is editable.

## Review
- Added continuous-position edit metadata for local `focus_tree` blocks so the host can rewrite existing `continuous_focus_position` coordinates or insert the block later using the same stable tree edit key.
- Added `buildContinuousFocusPositionTextChanges` and a matching workspace-edit builder that are BOM-safe, reject non-local trees, and support both replace and insert flows inside `focus_tree = {}`.
- Wired a new `applyContinuousFocusPositionEdit` message through the focus preview host and optimistic webview update path, reusing the existing local-version guard instead of forcing a full preview reload.
- In `Edit` mode, the `Continuous focuses` helper is now its own draggable target with pointer ownership separated from blank-canvas pan, create, marquee selection, minimap clicks, and relation editing.
- `Jump to continuous` and the minimap now read from the same continuous-position source of truth, and the minimap renders a dedicated continuous marker in addition to focus points.
- Added regression coverage in `test/unit/focustree-positionedit.test.ts`, `test/unit/focustree-schema.test.ts`, and `test/unit/focustree-minimap.test.ts` for replace/insert, BOM safety, read-only rejection, metadata capture, and continuous minimap projection.
- Updated `CHANGELOG.md` within the existing `0.13.20` line to record direct preview editing of `continuous_focus_position`.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.20.vsix`.
- Manual VS Code smoke for live dragging of `Continuous focuses` inside the preview was not run in this terminal session.
