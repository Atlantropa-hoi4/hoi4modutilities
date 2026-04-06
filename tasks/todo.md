# Focus Tree Inlay Preview Regression 2026-04-06

## Plan
- [x] Inspect the inlay preview load/render path and confirm why the window does not resolve
- [x] Restore inlay GUI/GFX resolution without reintroducing full index blocking on the hot path
- [x] Re-run compile and targeted focustree tests, then record the result

## Notes
- Current issue: the Focus Tree preview's Inlay Window surface appears non-functional.
- Root causes:
  - `src/previewdef/focustree/inlay.ts` limited GUI window discovery to `interface/scripted_gui/**/*.gui`, so inlay windows defined in other `interface/**/*.gui` files were invisible to the preview resolver.
  - The recent inlay GFX fast path only used indexed lookups and no longer fell back to cached `interface/*.gfx` scans for unresolved scripted-image names.

## Review
- Inlay GUI discovery now scans `interface/**/*.gui` and only reports matched `.gui` files back as preview dependencies, so the resolver can find inlay windows outside the `scripted_gui` subfolder without bloating dependency tracking.
- Inlay scripted-image GFX resolution now follows the same indexed-hit plus unresolved-only fallback scan pattern as focus icons, restoring non-indexed `GFX_*` inlay assets without reintroducing a full blocking scan on the hot path.
- The new `inlayshared` helper keeps the lookup logic pure enough for unit tests, so future inlay regressions can be caught without pulling in the VS Code runtime.

## Verification
- `npm run compile-ts` passed.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-inlay.test.js out\\test\\unit\\focustree-focusicongfx.test.js out\\test\\unit\\focustree-schema.test.js` passed with 11 tests.
- `npm run package` passed and produced `hoi4modutilities-0.13.22.vsix`.
