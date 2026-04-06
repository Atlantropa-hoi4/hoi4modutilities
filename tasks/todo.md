# Focus Tree Preview Icon GFX Regression 2026-04-06

## Plan
- [x] Inspect the icon GFX resolution path and pinpoint the recent focustree regression
- [x] Restore focus icon GFX resolution without reintroducing index-blocking behavior
- [x] Re-run compile and icon-related unit tests, then record the result

## Notes
- Current issue: focus tree icon GFX no longer display in the preview.
- Root cause: the recent non-blocking loader change stopped passing cached `interface/*.gfx` fallback scanning into `resolveFocusIconGfxFiles`, so unresolved icon names never gained the extra container files needed by the renderer.

## Review
- `src/previewdef/focustree/loader.ts` now wires `resolveFocusIconGfxFiles` back to the cached `interface/*.gfx` fallback scan helpers, while still using `tryGetGfxContainerFile` for the fast path. That restores resilient icon container discovery without forcing the preview to wait on the full GFX index first.
- The quick-path loader behavior from the previous performance work stays intact: ready index hits are still used immediately, and only unresolved names consult the cached interface sprite scan.

## Verification
- `npm run compile-ts` passed.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-focusicongfx.test.js out\\test\\unit\\focustree-focusiconlayout.test.js out\\test\\unit\\focustree-schema.test.js` passed with 12 tests.
- `npm run package` passed and produced `hoi4modutilities-0.13.22.vsix`.
