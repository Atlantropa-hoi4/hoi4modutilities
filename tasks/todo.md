# HOI4 Mod Utilities Focus Preview P2 Stability Todo

## Plan
- [x] Reconfirm the overlapping focus preview load snapshot risk in the host and loader
- [x] Make each focus preview refresh use its own content snapshot instead of shared mutable preview state
- [x] Preserve dependency cache reuse without reintroducing shared mutable loader state
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and verification notes

## Notes
- Scope for this pass is only the review P2 item: prevent overlapping focus preview refreshes from sharing the same mutable content snapshot.
- Keep the current `0.13.19` release line unless the user asks for a version change.
- P1 stale refresh ordering fix remains in place and should keep working after this change.

## Review
- `src/previewdef/focustree/index.ts` no longer shares a mutable `this.content` field across refreshes. Each full or partial refresh now builds a request-local `FocusTreeLoader` tied to that request's document text snapshot.
- `src/previewdef/focustree/loader.ts` and `src/util/loader/loader.ts` now support cloning the current dependency-loader cache into a snapshot loader and adopting the refreshed cache back after a successful load, so overlapping refreshes do not share mutable loader state while normal dependency reuse still works.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.19.vsix`.
- Manual VS Code smoke testing was not run in this terminal session.
