# HOI4 Mod Utilities Focus Preview Focus Delete Todo

## Plan
- [x] Add a right-click delete menu for editable focuses in the focus preview
- [x] Delete the chosen focus from the current document and remove dependent `prerequisite` and `relative_position_id` references from linked local focuses
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and the final packaged VSIX name

## Notes
- User request: right-clicking a focus should open a context menu with delete, and deleting a focus should also remove dependent links from connected focuses.
- Scope assumption: delete is available for editable focuses in preview edit mode and only rewrites the current file; dependency cleanup covers local `prerequisite` and `relative_position_id` references.
- This should stay within the existing consolidated `0.13.19` release line unless a separate release is explicitly requested.

## Review
- `webviewsrc/focustree.ts` now opens a custom `Delete focus` context menu on right-click for editable focuses in preview edit mode and posts a dedicated delete message back to the host.
- `src/previewdef/focustree/positioneditservice.ts` now deletes the chosen focus block and cleans local child `prerequisite` and `relative_position_id` references in the same writeback pass, including multi-focus prerequisite blocks.
- `src/previewdef/focustree/index.ts` now applies delete edits through the host and immediately reloads the preview from the updated document, matching the existing create flow.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.19.vsix`.
