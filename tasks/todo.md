# HOI4 Mod Utilities Focus Preview Bottom Create Buffer Todo

## Plan
- [x] Add persistent bottom canvas space so blank-space create can continue below the current lowest focus
- [x] Keep the change scoped to focus preview sizing and blank-space editing without altering focus positioning rules
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and the final packaged VSIX name

## Notes
- User request: when the lowest focus sits near the viewport bottom, the preview should still leave enough blank canvas to create more focuses underneath it.
- Best fix is to grow the rendered focus preview height with an explicit bottom creation buffer instead of changing focus-coordinate math.
- This should stay within the existing consolidated `0.13.19` release line unless a separate release is explicitly requested.

## Review
- `webviewsrc/focustree.ts` now keeps a fixed edit buffer below the lowest rendered focus by applying a computed minimum canvas height after each rebuild, using the current grid padding and several extra HOI4 rows.
- The fix stays in preview sizing only; focus coordinate math, drag editing, and blank-space click-to-grid conversion were left unchanged.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.19.vsix`.
