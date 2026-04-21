- [x] Broaden shine-button detection from exact `goals.gfx` to goals-like `.gfx` files.
- [x] Update fallback source discovery to find goals-like source files, not only `interface/goals.gfx`.
- [x] Reverify with a non-exact goals fixture and refresh review notes.
- [x] Guard preview command/restore paths against non-file startup editors like `walkThrough:` and `webview-panel:`.
- [x] Add regression coverage so unsupported editor URIs no longer raise "Can't find opened document" errors.
- [x] Collapse duplicate preview title-menu contributions into a single non-overlapping entry.
- [x] Reverify the editor-title manifest shape after removing duplicate preview button risk.
- [x] Restrict the editor title preview button to files with an actual resolved preview provider.
- [x] Reverify manifest conditions so unsupported files no longer get a preview button.
- [x] Refresh preview-button context from the active tab, not only the active text editor.
- [x] Add regression coverage for switching away from previewable text tabs to unrelated tabs.
- [x] Gate the shine title action on an executable focus-GFX context, not only a filename match.
- [x] Reverify shine-button context behavior for unrelated or non-workspace `*goals*.gfx` tabs.
- [x] Decouple feature-flag and configuration reads from module import time.
- [x] Split `PreviewManager` context/session responsibilities into smaller services without changing behavior.
- [x] Remove redundant custom-editor activation events now covered by modern VS Code activation.
- [x] Reverify with typecheck and targeted/unit tests after the Phase 1 refactor.
- [x] Introduce feature-oriented registration modules that own preview/index/editor contributions.
- [x] Switch `services/*` to assemble contributions from a single feature catalog instead of technical hard-coding.
- [x] Keep preview descriptor ordering stable while moving ownership to feature declarations.
- [x] Reverify feature-catalog refactor with typecheck plus preview/manifest unit coverage.
- [x] Split TypeScript configs into extension-host, webview, aggregate, and test roles.
- [x] Add a real parallel watch workflow for bundle plus role-specific typechecks.
- [x] Update local VS Code tasks and README so the new development flow is discoverable.
- [x] Reverify the build/test ergonomics refactor with compile, build, and targeted unit checks.
- [x] Regroup command-palette exposure by user flow instead of legacy command ordering.
- [x] Keep only high-signal editor-title actions and verify their discoverability from the palette.
- [x] Add architecture documentation for feature ownership, entrypoints, and high-risk modules.
- [x] Reverify manifest-facing Phase 4 changes with targeted tests.

Review note: widened both editor-title matching and workspace fallback discovery to `*goals*.gfx`, then hardened preview restore/request resolution so unsupported startup editors are ignored quietly instead of surfacing "Can't find opened document" errors. Finally collapsed duplicate preview title-menu entries, restricted the remaining preview button to `server.shouldShowHoi4Preview`, refreshed that context from the active tab, and added a separate `server.shouldShowFocusGfxShine` gate so the shine action only appears for executable workspace goals-like `.gfx` tabs. Reverified with targeted preview-manager/manifest tests plus `test-ui`.

Phase 1 note: moved feature flags to call-time evaluation on top of a safe configuration accessor, extracted preview-context/session responsibilities out of `PreviewManager`, and removed redundant custom-editor activation entries from the manifest. Reverified with `npm run compile-ts`, targeted mocha runs for preview/manifest/contentbuilder coverage, and the full `npm run test:unit` sweep; the only remaining failures are unrelated existing `focustree` schema/lint tests around shared/joint focus imports.

Phase 2 note: added `src/features/*` ownership modules plus a central feature catalog so previews, indexes, custom editors, and editor utilities are declared per feature instead of per technical layer. `services/previews.ts`, `services/editor.ts`, `services/indexes.ts`, and `previewdef/previewproviders.ts` now assemble from that catalog while preserving the previous preview priority order. Reverified with `npm run compile-ts`, `npm run compile-tests`, and targeted mocha for preview-manager plus manifest coverage.

Phase 3 note: split shared TypeScript settings into `tsconfig.base.json` plus dedicated `tsconfig.extension.json`, `tsconfig.webview.json`, and `tsconfig.test.json`, updated package scripts to run role-specific typechecks, added a parallel `scripts/watch.mjs` runner plus esbuild `--watch` support, and refreshed `.vscode/tasks.json` and `README.md` to match the new workflow. Reverified with `npm run compile-ts`, `npm run build:dev`, `npm run compile-tests`, and targeted mocha for preview-manager plus manifest coverage.

Phase 4 note: reorganized command-palette contributions into preview/tools/setup flows, added direct command-palette discoverability for focus shine generation, refreshed localized command titles to better match user intent, and added `docs/architecture/overview.md` as the stable entrypoint map for feature ownership and high-risk modules. Reverified with `npm run compile-ts`, `npm run compile-tests`, and targeted manifest mocha coverage.

Stabilization note: `focustree` schema/lint unit failures around imported shared/joint focuses are now resolved. The actual code fix was to stop gating `focus_tree.shared_focus` imports behind the condition-in-focus feature flag, and the supporting test fix was to reload `focustree/schema` and related helpers with a fresh module cache plus explicit VS Code mocks so full-suite execution no longer depends on test order. Reverified with full `npm run test:unit` and the suite is now green.

Verification note: full post-refactor validation is now complete. `npm run test` passes end-to-end, and `npm run test-ui` also passes when run sequentially after the main test pipeline. A one-off `EBUSY` during an earlier parallel run came from both commands trying to copy the same build artifact at once, not from an extension regression.

Release note: promoted the current refactor/stabilization batch to version 1.0.2, converted CHANGELOG [7mUnreleased[0m to a dated release entry, and aligned package metadata before commit.
Focus tree review 2026-04-27:
- [x] Check git status and repository guidance before review.
- [x] Map Focus Tree implementation, webview, shared index, and tests.
- [x] Compare supported syntax against current community documentation for national focus, shared focus, joint focus, inlay, and webview expectations.
- [x] Run typecheck and targeted Focus Tree/shared index unit verification.

Review note: current Focus Tree coverage is broad, but review found follow-up work around shared-focus import/index scoping, imported shared-focus ID collision handling, and webview HTML sanitization. Reverified after refreshing stale node_modules with `npm ci`; `npm run compile-ts`, `npm run compile-tests`, and targeted Focus Tree/shared-index mocha tests passed.

P2 fix note 2026-04-27:
- [x] Preserve local focus definitions when an imported shared/joint focus has the same ID, and report the duplicate instead of overwriting.
- [x] Replace Focus Tree webview dropdown/selector HTML string insertion for mod-derived option values with DOM node creation.
- [x] Reverify with Focus Tree schema/lint/shared-index unit coverage plus extension/webview typechecks.
