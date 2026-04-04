# HOI4 Mod Utilities Focus Preview Canvas Padding Todo

## Plan
- [x] Inspect the current focus preview canvas padding path
- [x] Extend the edit buffer so focus preview has spare space on all sides, not only the bottom
- [x] Record the correction in `tasks/lessons.md`
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and verification notes

## Notes
- Scope for this pass is the focus preview canvas bounds in `webviewsrc/focustree.ts`.
- Keep the current `0.13.20` release line unless the user asks for a separate version.
- The create/edit buffer should exist on left, top, right, and bottom, not only under the lowest focus.

## Review
- Focus preview now reserves edit buffer on left, top, right, and bottom by shifting the rendered grid origin and enlarging the minimum canvas width and height together.
- Blank-space creation and drag calculations continue to use the updated `currentGridLeftPadding` and `currentGridTopPadding`, so the extra space remains usable rather than only decorative.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- `npm test` initially failed only because it was run in parallel with `npm run package` and the package step cleaned `out/`; a standalone rerun passed.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.20.vsix`.
- Manual VS Code preview smoke was not run in this terminal session.
