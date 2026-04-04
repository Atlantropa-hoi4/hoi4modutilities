# Effect Preview Re-check

## Plan
- [x] Re-inspect the event effect extraction path and reproduce any child-event preview mismatches with a focused unit fixture
- [x] Fix the effect-to-preview mapping so distinct child-event edges remain distinct in the event preview graph
- [x] Add regression coverage for the reproduced effect preview case
- [x] Run targeted verification and capture review notes

## Notes
- This pass is scoped to effect-driven event preview behavior, not unrelated preview UI changes.
- Initial inspection found a likely collapse point in `src/previewdef/event/schema.ts`, where option child events are deduplicated by `eventName + scopeName` without considering delay fields.

## Review
- Root cause was in `src/previewdef/event/schema.ts`: option child events were deduplicated by `eventName + scopeName`, so distinct effect calls to the same child event lost their separate delay metadata before the event preview graph was built.
- Updated the dedupe key to include `days`, `hours`, `randomDays`, and `randomHours`, matching the renderer's notion of a distinct event edge.
- Added `test/unit/event-schema.test.ts` coverage proving that two calls to the same child event in one option remain separate when their delays differ.
- Verified with `npm run test` and a serial `npm run package`.
- `npm run test-ui` still fails locally with the pre-existing `spawn EPERM` while launching `@vscode/test-electron`, so live VS Code webview verification remains environment-blocked in this session.

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
