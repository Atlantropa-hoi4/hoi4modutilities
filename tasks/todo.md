# HOI4 Mod Utilities Focus Preview Structural Performance Optimization Todo

## Plan
- [x] Confirm where current-document focus preview refresh latency is introduced
- [x] Add per-preview debounce controls to the preview manager/base infrastructure
- [x] Make focus-tree previews react faster to active-document edits while keeping dependency-triggered reloads conservative
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and the final packaged VSIX name

## Notes
- User report: even after the previous performance pass, the preview still reacts too slowly when focus content changes.
- This pass goes beyond debounce tuning and reduces the amount of work done on each same-document preview refresh.
- Keep the current consolidated `0.13.19` release line unless the user asks for a separate release number.

## Review
- `src/previewdef/focustree/contentbuilder.ts` now separates the focus-tree payload from the shell HTML, so the host can reuse the existing webview for same-document updates instead of rebuilding the whole page every time.
- `src/previewdef/focustree/index.ts` now sends `focusTreeContentUpdated` messages for same-structure focus-tree refreshes and falls back to a full HTML reload only when the toolbar structure changes or the webview is not ready yet.
- `webviewsrc/focustree.ts` now applies refreshed focus-tree data, rendered templates, grid settings, and dynamic CSS in place, then reruns `buildContent()` inside the already-loaded webview.
- The earlier debounce improvement remains in place: `src/previewdef/previewmanager.ts` uses per-preview refresh timers, and `src/previewdef/focustree/index.ts` keeps focus-tree current-document edits on a shorter `150ms` debounce.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.19.vsix`.
