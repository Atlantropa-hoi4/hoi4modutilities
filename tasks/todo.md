# Preview Performance P1 2026-04-06

## Plan
- [x] Reconfirm the audited P1 scope and the current preview/index hot paths
- [x] Replace full-document `canPreview` scans with path-first detection plus bounded text sampling where paths are ambiguous
- [x] Cache preview-provider selection for unchanged document versions so editor/context updates stop recomputing detection work
- [x] Move eligible lazy index builds off the foreground path with safe background prewarm, then verify with compile/tests/package

## Notes
- Scope for this pass is the earlier audit's `P1` items only. `P2` remains backlog work after this lands.
- P0 loader caching and shared-focus reverse indexing are already in place from the previous step.

## Review
- `src/previewdef/previewdetect.ts` and `src/previewdef/previewdetectshared.ts` now provide bounded preview-text sampling and reusable regex detection helpers, and the focus tree, technology, event, and MIO preview selectors now use path-first checks plus sampled text instead of whole-document `getText()` scans on ambiguous `.txt` files.
- `src/previewdef/mio/index.ts` now requires cheap sampled MIO hint keywords before attempting parser-based detection on off-path files, which cuts unnecessary parser work during editor/context switching.
- `src/previewdef/previewmanager.ts` now caches the resolved preview provider per document version, so repeated active-editor, visible-editor, and open-document context updates stop rerunning provider detection for unchanged documents.
- `src/util/indexprewarm.ts` now schedules a delayed background prewarm after activation, and `src/util/sharedFocusIndex.ts`, `src/util/gfxindex.ts`, and `src/util/localisationIndex.ts` expose silent prewarm paths that reuse the same index builders without surfacing status-bar churn during idle warmup.
- `test/unit/preview-detection.test.ts` adds coverage for bounded preview sampling and regex priority matching, and the existing MIO/schema/index tests still cover the parser-backed preview and shared-focus behavior touched by this pass.

## Verification
- `npm run compile-ts` passed.
- `node .\node_modules\mocha\bin\mocha --exit out\test\unit\preview-detection.test.js out\test\unit\mio-preview.test.js out\test\unit\shared-focus-index.test.js out\test\unit\focustree-schema.test.js out\test\unit\focustree-focusicongfx.test.js out\test\unit\focustree-conditionpresets.test.js out\test\unit\focustree-positionedit.test.js` passed with 50 tests.
- `npm run package` passed and produced `hoi4modutilities-0.13.22.vsix`.
