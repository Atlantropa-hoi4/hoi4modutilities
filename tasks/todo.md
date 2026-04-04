# HOI4 Mod Utilities Focus Preview Relation Visualization Todo

## Plan
- [x] Inspect the current focus relation render path, selection state, and regression surfaces
- [x] Extend gridbox connection metadata for prerequisite and exclusive visualization
- [x] Add focused relation highlighting and node dimming without rebuilding geometry on hover
- [x] Add node-adjacent relation summary UI that follows hover, selection, and pending-link priority
- [x] Add regression coverage for relation metadata and multi-select relation union behavior
- [x] Update changelog notes for the same `0.13.20` release line
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and verification notes

## Notes
- Scope for this pass is relation visualization only in the focus preview; parser writeback and relation edit semantics stay unchanged.
- Keep the default visualization mode focused: calm idle view, stronger hover/selection emphasis, and pending-link state as the top visual priority.
- Preserve existing search highlight, status badges, multi-select outline, and context-menu hit targets while relation visuals are active.

## Review
- Extended `GridBoxConnection` with relation visualization metadata and emitted `data-*` attributes on rendered line segments so the webview can filter and restyle prerequisite and exclusive lines without recalculating geometry.
- Added a pure `focusrelations` helper for active-focus relation union calculation, then reused it in the webview to drive focused prerequisite and mutually exclusive emphasis from hover, edit-mode selection, and pending-link state.
- Relation visualization now keeps the idle view calmer, dims unrelated lines and nodes only while a focused relation context is active, and shows a node-adjacent summary overlay with prerequisite, group, exclusive, and dashed-line guidance.
- Added regression coverage in `test/unit/focustree-relations.test.ts` for multi-select relation unions and rendered line metadata attributes.
- Updated `CHANGELOG.md` within the existing `0.13.20` release line to record the new relation visualization work.
- Verification passed sequentially: `npm run compile-ts`, `npm run lint`, `npm test`, `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.20.vsix`.
- Manual VS Code preview smoke for live hover, dimming, and node-adjacent relation summary was not run in this terminal session.
