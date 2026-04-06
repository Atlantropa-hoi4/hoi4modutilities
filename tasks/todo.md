# Focus Tree Preview Bugfix Follow-up 2026-04-06

## Plan
- [x] Re-investigate the remaining infinite-loading path in the focustree host/contentbuilder/loader flow
- [x] Remove blocking preview-time waits on global localisation and GFX index builds where the focustree renderer can use already-resolved data or safe fallbacks
- [x] Add or extend regression coverage for the new non-blocking render helpers
- [x] Re-run compile, targeted unit tests, and package verification, then update review notes and lessons learned

## Notes
- Remaining symptom after the previous patch: Focus Tree Preview still stays on the initial `Loading...` shell for the user.
- Current root-cause hypothesis is that the host-side HTML build still blocks on full localisation/GFX index work before the first focustree HTML is emitted.

## Review
- `src/previewdef/focustree/contentbuilder.ts` no longer waits for full localisation index builds while composing the first focustree HTML. The preview now uses cached localisation entries only and otherwise falls back to the raw focus ids/text immediately, so the shell can render without waiting for the whole localisation corpus.
- `src/previewdef/focustree/loader.ts`, `src/previewdef/focustree/inlay.ts`, and `src/util/gfxindex.ts` now avoid blocking the focustree loader on cold global/workspace GFX index construction. Inlay/scripted-GUI work is skipped entirely when the current tree has no inlay refs, and cold-start icon/inlay resolution now uses already-ready caches only instead of forcing a full interface scan before the preview can appear.
- `src/util/indexprewarm.ts` now starts the preview-index prewarm almost immediately and runs the shared-focus, GFX, and localisation warmups in parallel so later focustree refreshes have a better chance of using warm caches.
- `test/unit/localisation-index.test.ts` adds pure regression coverage for the localisation fallback resolver used by the non-blocking preview text path.

## Verification
- `npm run compile-ts` passed.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-selectionstate.test.js out\\test\\unit\\focustree-conditionpresets.test.js out\\test\\unit\\focustree-schema.test.js out\\test\\unit\\focustree-positionedit.test.js out\\test\\unit\\focustree-focusicongfx.test.js out\\test\\unit\\shared-focus-index.test.js out\\test\\unit\\preview-detection.test.js out\\test\\unit\\localisation-index.test.js` passed with 53 tests.
- `npm run package` passed and produced `hoi4modutilities-0.13.22.vsix`.
