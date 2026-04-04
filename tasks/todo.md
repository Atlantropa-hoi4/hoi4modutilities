# Non-Focus Preview P3 Fix 2026-04-05

## Plan
- [x] Add a non-canonical MIO preview detection path so preview routing is not locked to one folder
- [x] Cover the detection with a unit regression test and an off-path integration smoke case
- [x] Re-run serial verification and record what passed versus what remained environment-blocked

## Notes
- Scope is limited to the remaining P3 issue from the non-focus preview review: MIO preview path lock.
- This pass should preserve canonical-path behavior and only widen routing for files that actually look like MIO definitions.

## Review
- Added parser-backed MIO preview fallback detection in `src/previewdef/mio/detect.ts` and routed `src/previewdef/mio/index.ts` through it for non-canonical `.txt` files.
- Canonical MIO files under `common/military_industrial_organization/organizations/*` still keep top priority `0`; the new fallback only applies when the file path does not already match that route.
- The fallback is intentionally narrow: it recognizes MIO trait and mutator structures (`trait`, `add_trait`, `override_trait`, `remove_trait`) only when they contain MIO-specific shape markers, so focus-tree style files with overlapping keys such as `relative_position_id` do not get misclassified.
- Added unit coverage in `test/unit/mio-preview.test.ts` for positive detection and overlap-key false-positive rejection.
- Added an off-path integration smoke case in `test/integration/extension.test.ts` plus fixture `test/fixtures/workspace/misc/sample_mio_preview.txt` so non-canonical MIO routing is explicitly exercised by the UI suite.
- Serial verification results:
  - `npm run test` passed with 80 passing tests.
  - `npm run package` passed and produced `hoi4modutilities-0.13.21.vsix`.
  - `npm run test-ui` still stops at the pre-existing local `spawn EPERM` while launching `@vscode/test-electron` after successful `compile-ts` and `webpack`, so the new off-path smoke case could not be executed end-to-end in this environment.

# Non-Focus Preview P2 Fix 2026-04-05

## Plan
- [x] Reduce the generic non-focus preview refresh lag in the shared preview base
- [x] Fix the technology preview navigator CSS typo that could break click hit areas
- [x] Expand non-focus preview smoke coverage for representative webview and custom-editor surfaces
- [x] Re-run serial verification and record what passed versus what remained environment-blocked

## Notes
- Scope covers all preview features except focus tree preview.
- This pass is limited to the P2 items that were actionable without designing a new preview surface such as `effect`.

## Review
- Lowered the shared non-focus preview document-change debounce from `1000ms` to `250ms` in `src/previewdef/previewbase.ts`, so standard webview previews react noticeably faster after edits without changing any provider-specific behavior.
- Fixed the invalid `height: p;` CSS declaration in `src/previewdef/technology/contentbuilder.ts` to `height: 0;`, which restores valid navigator wrapper styling for sub-technology click regions.
- Expanded `test/integration/extension.test.ts` smoke coverage to exercise representative non-focus surfaces: event, technology, gui, gfx, mio, world map, TGA, and DDS.
- Added minimal workspace fixtures for the new smoke paths under `test/fixtures/workspace/common/technologies`, `test/fixtures/workspace/common/military_industrial_organization/organizations`, `test/fixtures/workspace/interface`, and `test/fixtures/workspace/gfx`.
- Serial verification results:
  - `npm run test` passed.
  - `npm run package` passed and produced `hoi4modutilities-0.13.21.vsix`.
  - `npm run test-ui` still stops at the pre-existing local `spawn EPERM` while launching `@vscode/test-electron` after successful `compile-ts` and `webpack`, so the expanded smoke suite is present but could not be executed end-to-end in this environment.
- Remaining non-focus preview issues not solved in this P2 pass:
  - There is still no dedicated `effect` preview provider wired into `PreviewManager`.
  - MIO preview remains path-locked to `common/military_industrial_organization/organizations/*` with no content-based fallback.

# README Known Issue Fix Todo

## Plan
- [x] Reproduce the README event-tree duplication issue from the current renderer path and pin the root cause in the event preview layout code
- [x] Implement a minimal event-tree layout change so identical child events reached from different options render once instead of duplicating the whole subtree
- [x] Add regression coverage for the shared-child event case and update `README.md` to reflect the fixed issue
- [x] Run compile, lint, unit tests, and package verification; then record review notes

## Notes
- Scope for this pass is the event tree preview issue described in `README.md`.
- Focus-tree README drift was observed during investigation, but this task will only remove README claims that are directly verified by the implemented fix.

## Review
- Root cause was in `src/previewdef/event/contentbuilder.ts`: identical child events were deduplicated in schema only within a single option, but the renderer still rebuilt the same target subtree once per option path.
- Added `src/previewdef/event/sharedchildren.ts` to detect option-level shared child events by rendered identity (`event id + resolved scope + delay`) and let the event renderer place that subtree once while wiring each option node to it.
- Added `test/unit/event-contentbuilder.test.ts` to lock the shared-child grouping behavior so later layout changes do not reintroduce duplicate event branches.
- Updated `README.md` to remove the event-tree duplicate issue from `Known Issues`.
- Verified with `npm run compile-ts`, `npm run lint`, `npm run test:unit`, and `npm run package`.
- `npm run verify` reached `npm run test-ui` but that step failed locally with `spawn EPERM` while launching `@vscode/test-electron`, so full UI verification remains environment-blocked in this session.

## CI Follow-up 2026-04-05

### Plan
- [x] Inspect the latest `test-ui` GitHub Actions failure and pin the runtime import path that triggers `Cannot find module './worldmapview.html'`
- [x] Remove integration-test coupling to webpack-only preview internals so `vscode-test` no longer loads `out/src/previewdef/worldmap/*.js`
- [x] Re-run the relevant verification commands and record whether the asset-loading failure is gone

### Notes
- The failing stack came from `test/integration/extension.test.ts` importing `previewManager`, which pulled `out/src/previewdef/previewmanager.js` into the test host.
- `previewmanager` eagerly imports `worldmap` preview definitions, and the plain `out/` runtime cannot resolve webpack-handled assets such as `./worldmapview.html`.

### Review
- `npm run compile-ts` passed after removing the integration-test import of `previewManager`.
- `npm run test:unit` passed with 77 passing tests.
- `npm run test-ui` no longer fails with `Cannot find module './worldmapview.html'`; in this local environment it now stops at the pre-existing `@vscode/test-electron` launch limit `spawn EPERM`.

## Release Packaging Follow-up 2026-04-05

### Plan
- [x] Inspect the release `npm run package` failure and identify why `vscode:prepublish` hits `EPERM` on `.vscode-test`
- [x] Adjust the npm clean scripts so package builds do not delete the VS Code test runtime directory
- [x] Re-run package-related verification and record whether the prepublish failure is gone

### Notes
- The failing path was `.vscode-test/vscode-win32-x64-archive-1.114.0/Code.exe`, which can remain locked briefly after `test-ui` on Windows runners.
- `vscode:prepublish` only needs to clean package build outputs (`dist`, `out`, `static`); deleting `.vscode-test` there is unnecessary for VSIX generation.

### Review
- `npm run package` now passes after `vscode:prepublish` stops deleting `.vscode-test`.
- The release-blocking `EPERM` on `.vscode-test/.../Code.exe` is avoided because package cleanup is now limited to `dist`, `out`, and `static`.
- Sequential `npm run package` produced `hoi4modutilities-0.13.21.vsix` successfully at the repository root.
