# Focus Preview P0 Performance 2026-04-06

## Plan
- [x] Reconfirm current hot paths, repo lessons, and the exact P0 scope from the earlier audit
- [x] Cache focus inlay window, scripted GUI window, and interface GFX fallback discovery so preview loads stop rescanning/parsing whole folders per render
- [x] Keep shared focus lookup on a reverse index (`focus id -> file`) and verify incremental index maintenance with regression tests
- [x] Rewire the focus tree loader to use the cached fallback helpers and run targeted verification (`compile-ts`, unit tests, `package`)

## Notes
- Scope for this pass is the audited `P0` items only. `P1` and `P2` remain backlog work after this lands.
- Focus preview reopen latency was already improved by retaining hidden webview context; this pass targets the remaining host-side parse/index bottlenecks on true loads.

## Review
- `src/previewdef/focustree/inlay.ts` now keeps parsed focus inlay windows, scripted GUI container windows, and interface `.gfx` fallback sprite maps behind `PromiseCache`, keyed by folder contents plus per-file expiry tokens. Repeated preview loads now reuse the parsed results instead of rescanning and reparsing those folders every render.
- `src/previewdef/focustree/inlay.ts` also clones resolved inlay structures before attaching per-tree position, GUI, and GFX resolution data, so cached parse results stay immutable across preview loads.
- `src/previewdef/focustree/loader.ts` now reuses the cached interface GFX helpers for unresolved focus icon lookup instead of doing a fresh `interface/*.gfx` scan for every load.
- `src/util/sharedFocusIndex.ts` now builds on a dedicated `src/util/sharedFocusIndexState.ts` helper that maintains both `file -> ids` and `id -> files`, making shared-focus resolution direct instead of linear over all indexed files.
- `test/unit/shared-focus-index.test.ts` covers reverse-index insert, replace, and removal behavior, and the helper extraction keeps those tests runnable without a VS Code host shim.

## Verification
- `npm run compile-ts` passed.
- `node .\node_modules\mocha\bin\mocha --exit out\test\unit\shared-focus-index.test.js out\test\unit\focustree-focusicongfx.test.js out\test\unit\focustree-schema.test.js out\test\unit\focustree-conditionpresets.test.js out\test\unit\focustree-positionedit.test.js` passed with 44 tests.
- `npm run package` passed and produced `hoi4modutilities-0.13.22.vsix`.
