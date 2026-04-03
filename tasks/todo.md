# HOI4 Mod Utilities Focus Preview Responsiveness Optimization Todo

## Plan
- [x] Confirm where current-document focus preview refresh latency is introduced
- [x] Add per-preview debounce controls to the preview manager/base infrastructure
- [x] Make focus-tree previews react faster to active-document edits while keeping dependency-triggered reloads conservative
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and the final packaged VSIX name

## Notes
- User report: even after the previous performance pass, the preview still reacts too slowly when focus content changes.
- Current suspicion: the preview manager's document-change debounce is dominating the user's perceived latency.
- Keep the current consolidated `0.13.19` release line unless the user asks for a separate release number.

## Review
- `src/previewdef/previewmanager.ts` no longer forces the current document preview path through a hardcoded 1000ms debounce. It now schedules per-preview timers and reads each preview's preferred debounce window.
- `src/previewdef/previewbase.ts` now exposes `getDocumentChangeDebounceMs()`, and `src/previewdef/focustree/index.ts` overrides it to `150ms`, so active focus-tree document edits reach the preview much sooner while dependency-driven updates remain on the older conservative path.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.19.vsix`.
