# HOI4 Mod Utilities Focus Preview Edit Icon Toolbar Todo

## Plan
- [x] Convert the `Edit` toggle into a warning-style icon button
- [x] Move the icon to the far right of the first toolbar row without disturbing the remaining control order
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and the final packaged VSIX name

## Notes
- User request: make `Edit` an icon button like warnings and place it at the far right of the first row.
- This is a toolbar-only presentation change; edit-mode behavior itself should remain unchanged.
- This should stay within the existing consolidated `0.13.19` release line unless a separate release is explicitly requested.

## Review
- `src/previewdef/focustree/contentbuilder.ts` now renders `Edit` as a codicon button, removes its text label, and pushes it to the far right of the first toolbar row with an auto-margin icon group.
- `webviewsrc/focustree.ts` now styles the active edit state with icon-button color and background highlighting instead of relying on text weight, which no longer applies once the label is gone.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.19.vsix`.
