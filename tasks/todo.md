# Preview Performance P2 2026-04-06

## Plan
- [x] Reconfirm the audited P2 scope and the current localisation-highlighting/world-map diff hot paths
- [x] Reduce localisation highlighting work for HOI4 localisation files that do not currently contain highlightable tokens
- [x] Bound world map incremental diff comparison cost so large edits fall back sooner instead of paying unbounded deep equality work
- [x] Re-run compile, targeted unit tests, and package verification after the P2 changes

## Notes
- Scope for this pass is the earlier audit's `P2` items only.
- P0 and P1 performance changes remain part of the same `0.13.22` release batch.

## Review
- `src/util/localisationHighlighting.ts` now distinguishes HOI4 localisation documents that currently have no highlightable token hints, skipping the expensive full-document text materialization and decoration application path for those files until a real token appears.
- `src/previewdef/worldmap/worldmapdiff.ts` adds a shallow-first, budgeted comparison helper for world-map incremental updates, and `src/previewdef/worldmap/worldmap.ts` now uses that helper so large or widespread map edits fall back to a summary refresh sooner instead of spending excessive time in repeated deep equality checks.
- `test/unit/worldmap-diff.test.ts` covers the new budgeted world-map comparison helper, and `test/unit/localisation-highlighting.test.ts` now stubs the VS Code host so the existing localisation helper tests remain runnable in the plain Mocha environment.

## Verification
- `npm run compile-ts` passed.
- `node .\node_modules\mocha\bin\mocha --exit out\test\unit\localisation-highlighting.test.js out\test\unit\worldmap-diff.test.js out\test\unit\preview-detection.test.js out\test\unit\mio-preview.test.js out\test\unit\shared-focus-index.test.js out\test\unit\focustree-schema.test.js out\test\unit\focustree-focusicongfx.test.js out\test\unit\focustree-conditionpresets.test.js out\test\unit\focustree-positionedit.test.js` passed with 59 tests.
- `npm run package` passed and produced `hoi4modutilities-0.13.22.vsix`.
