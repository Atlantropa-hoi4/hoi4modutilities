# HOI4 Mod Utilities Focus Preview Multi-Select Todo

## Plan
- [x] Inspect the current focus preview drag/pan/create interaction flow
- [x] Add marquee multi-select for focuses without breaking existing edit-mode pan and drag behavior
- [x] Update `tasks/lessons.md` for the new interaction rule
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and verification notes

## Notes
- Scope for this pass is the focus preview webview interaction layer in `webviewsrc/focustree.ts`.
- Keep the current `0.13.20` release line unless the user asks for a separate version.
- To avoid regressing the restored blank-space pan in edit mode, use `Shift + left drag` on blank canvas for marquee multi-select.

## Review
- Focus preview now supports marquee multi-select with `Shift + left drag` on blank canvas in edit mode, so users can select multiple focuses without regressing the restored plain-drag pan path.
- Selection is tracked per focus tree in webview state, highlighted immediately, cleared on blank clicks or `Escape`, and pruned automatically when the rendered tree changes.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.20.vsix`.
- Manual VS Code preview smoke for marquee selection was not run in this terminal session.
