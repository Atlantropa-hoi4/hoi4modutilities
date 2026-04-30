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

Whole-codebase review 2026-04-27:
- [x] Run baseline typecheck, lint, and unit verification.
- [x] Inspect architecture, extension entrypoints, preview/webview services, and test coverage for small high-confidence improvements.
- [x] Implement scoped fixes only where the audit finds concrete risk.
- [x] Reverify changed behavior and review the final diff.

Review note: baseline `npm run compile-ts`, `npm run lint`, and `npm run test:unit` were green. Audit found remaining raw HTML construction in MIO preview condition options and trait labels/attributes, so MIO now builds condition dropdown options with DOM nodes and shared text/attribute escaping helpers protect MIO/Focus Tree rendered labels. Reverified with targeted html/focusrender/MIO tests, full `npm run test`, and `npm run test-ui`.

Dependency and webview hardening 2026-04-27:
- [x] Update `lodash` to the audited safe production range and verify production audit is clean.
- [x] Update package/dev tooling candidates in order: `@vscode/vsce`, `@types/vscode`, `@types/node`, TypeScript, and `@typescript-eslint/*`.
- [x] Align the minimum VS Code engine with the updated VS Code API typings.
- [x] Replace GUI preview toggle HTML injection with structured data plus DOM node creation.
- [x] Render Focus Tree warnings with DOM nodes instead of HTML strings.
- [x] Reduce touched webview `window as any` usage with typed bootstrap globals.
- [x] Reverify with compile, lint, unit/integration tests, audit, and VSIX packaging.

Review note: `npm audit --omit=dev` is clean after `lodash` 4.18.1. Full `npm audit` still reports dev-only advisories in the VSCE/Mocha toolchain with odd downgrade suggestions, so those were not forced. Reverified with `npm run test`, `npm run test-ui`, and `npm run package`.

Preview command context fix 2026-04-28:
- [x] Stop reusing a stale previewable text editor when VS Code cannot resolve an active tab.
- [x] Guard the editor-title preview action to file/untitled resources before applying previewability context.
- [x] Reverify with targeted preview-manager and manifest unit tests.

Review note: fixed stale Preview HOI4 file visibility by clearing preview context when there is no resolved active tab, then added a file/untitled resource guard to the editor-title menu contribution. Reverified with `npm run compile-ts`, `npm run compile-tests`, targeted preview-manager plus manifest mocha tests, and `npm run lint`.

Follow-up note: Extension details tabs can still carry resource-like title menu context, so the editor-title preview action now requires VS Code's `isFileSystemResource` context rather than only checking `resourceScheme`.

Strict visibility note: removed the command-palette unloaded fallback for `Preview HOI4 file`; it now requires both `isFileSystemResource` and the resolved `server.shouldShowHoi4Preview` provider context. Reverified the packed VSIX manifest contains the strict editor-title and command-palette conditions.

Stale context note: Extensions details tabs can leave stale tab resource data behind while `activeTextEditor` is undefined, so preview context resolution now clears immediately when there is no active text editor.

Command guard note: added command-level `enablement` for `Preview HOI4 file` and made unsupported command execution silently clear preview context instead of showing "Can't preview this file".

Visibility note: editor-title visibility now uses only the extension-owned `server.shouldShowHoi4PreviewTitle` context, so stale VS Code resource contexts can disable neither hide nor show the button by themselves.

Focus tree icon dependency fix 2026-04-28:
- [x] Include resolved focus icon `texturefile` paths in preview dependencies.
- [x] Refresh dependent previews when watched image asset files change.
- [x] Reverify with focused resolver, preview-manager, and Focus Tree tests.

Review note: Focus Tree icon GFX resolution now returns both container `.gfx` files and matched sprite `texturefile` paths, with texture lookup reusing the per-GFX sprite cache. PreviewManager also watches workspace `.dds`, `.tga`, and `.png` asset changes and refreshes dependent previews through the existing dependency tracker. Reverified with compile, lint, targeted Focus Tree/preview-manager mocha coverage, and full `npm run test:unit`.

Focus tree missing icon warning fix 2026-04-28:
- [x] Return unresolved icon names from Focus Tree icon GFX resolution.
- [x] Add preview warnings for focuses that reference unresolved icon GFX names.
- [x] Reverify with focused icon warning/resolver tests and Focus Tree coverage.

Review note: unresolved focus icon GFX names now flow out of icon resolution and are converted into `focus-icon-gfx-missing` parse warnings with focus navigation metadata during full asset loads. Deferred first render still stays lightweight; the full hydration pass supplies the warning state. Reverified with targeted Focus Tree icon tests, compile, lint, and full `npm run test:unit`.

Focus tree icon resolution reuse fix 2026-04-28:
- [x] Preserve the resolved icon name to `.gfx` file mapping from the Focus Tree icon resolver.
- [x] Reuse that mapping during icon CSS generation instead of probing every resolved `.gfx` file again.
- [x] Include the mapping in render style dependency metadata so changed icon resolution triggers a full style refresh.
- [x] Reverify with focused contentbuilder/render-patch tests plus standard compile/lint/unit checks.

Focus tree icon loading refactor 2026-04-30:
- [x] Return a single focus icon asset resolution object with `.gfx`, texture, expiry, unresolved, and style-signature data.
- [x] Use the asset resolution in loader dependencies, warning generation, icon CSS rendering, and render cache style invalidation.
- [x] Preserve deferred placeholder rendering without icon image lookup.
- [x] Reverify with focused Focus Tree icon tests plus standard compile/lint/unit checks.

Review note: Focus Tree icon loading now carries one asset-resolution object from load through render, including texture expiry tokens in the style signature so asset-only changes force a full icon CSS refresh. Full icon CSS generation now uses the resolved `.gfx` mapping and unresolved-name list instead of broad rescans, while deferred first render still emits grey placeholders without image lookup. Reverified with focused icon/session/preview-manager mocha coverage, `npm run compile-ts`, `npm run lint`, and full `npm run test:unit`.

Focus tree live refresh 2026-04-30:
- [x] Watch preview dependency file types beyond images, including focus, GFX, GUI, localisation, and mod descriptor files.
- [x] Add selected mod content-root watchers and refresh them when workspace folders or `hoi4ModUtilities.modFile` changes.
- [x] Add a Focus Tree external-file refresh hook so newly created shared focus/localisation/GFX/GUI files can invalidate open previews before they appear in exact dependencies.
- [x] Reverify with preview-manager live refresh coverage plus standard compile/lint/unit checks.

Review note: PreviewManager now routes broad dependency watcher events through exact dependency matches and a Focus Tree-specific external change hook, while also watching selected mod content roots. Focus Tree Preview opts into live refresh for relevant national focus, interface, localisation, image, and `.mod` paths without changing webview messages or user-facing commands.

Focus tree localization display 2026-04-28:
- [x] Render actual localized focus text under each focus id using the configured preview language.
- [x] Avoid showing unresolved localization keys as if they were real localized text.
- [x] Refresh Focus Tree previews when the preview localization setting changes.
- [x] Reverify with focused Focus Tree render tests plus standard compile/lint/unit checks.

Localisation index filename compatibility 2026-04-28:
- [x] Accept localisation filenames such as `MEO - New Soul l_korean.yml`.
- [x] Keep existing underscore and dash language suffix filename support.
- [x] Reverify with localisation index tests plus standard compile/lint/unit checks.

Selected mod root file loading 2026-04-28:
- [x] Search the selected `.mod` or `descriptor.mod` content root in addition to opened workspace folders.
- [x] Support launcher `.mod` files whose descriptor path points to `mod/<folder>`.
- [x] Reverify with fileloader/localisation/focus render tests plus standard compile/lint/unit checks.

Parser compatibility 2026-04-29:
- [x] Accept signed/trailing-dot numeric values and preserve dotted date-like values as symbolic tokens.
- [x] Parse longest-match comparison operators, permissive HOI4 bare symbols, and anonymous block lists.
- [x] Reverify with parser regressions, full unit coverage, lint, typecheck, and read-only game/mod sweep.

Review note: improved `parseHoi4File` compatibility for vanilla and Kaiserreich script syntax without changing the public parser API. The read-only sweep over the provided game and mod paths now leaves only source/prose exclusions: unbalanced vanilla script files plus `interface/credits.txt`.

HOI4 formatter v1 2026-04-29:
- [x] Add a token-based formatter core for script and GUI/GFX profiles without changing the parser public API.
- [x] Register a VS Code document formatting provider through the existing editor feature registry.
- [x] Keep map/localisation/root prose files out of formatter scope.
- [x] Cover Kaiserreich-style spacing, comments, inline blocks, names lists, GUI coordinate blocks, and provider path filtering with unit tests.
- [x] Reverify with typecheck, unit tests, lint, and a read-only Kaiserreich format/parse sweep.

Review note: added a VS Code document formatter backed by a token-preserving HOI4 formatter profile for script and GUI/GFX files. Reverified with `npm run compile-ts`, `npm run test:unit`, `npm run lint`, and a read-only Kaiserreich Dev Build in-memory format/parse sweep over 5,049 supported files with 0 failures.

HOI4 formatter range/on-type support 2026-04-29:
- [x] Add range formatting support that formats selected full lines with surrounding indentation context.
- [x] Add on-type formatting support for Enter and `}` indentation edits.
- [x] Cover range formatting and on-type provider behavior with unit tests.
- [x] Reverify with typecheck, unit tests, lint, and a read-only Kaiserreich format/parse sweep.

Formatter readability regression 2026-04-29:
- [x] Preserve Kaiserreich-style grouped blank lines in decision/effect blocks.
- [x] Preserve short inline blocks such as `allowed = { always = no }` and `white_peace = { tag = MEO }`.
- [x] Add an explicit regression for the reported `MEO_defend_success` decision style.

Formatter aggressive standardisation 2026-04-29:
- [x] Trim trailing whitespace in real full-line and inline comments.
- [x] Remove empty inline comment markers such as `focus = { #`.
- [x] Collapse consecutive blank lines to a single blank line.
- [x] Confirm the TFR Korea focus file preview now reduces trailing whitespace lines to 0 without editing the mod file.

Formatter Kaiserreich structural spacing 2026-04-29:
- [x] Add blank-line separation before repeated `focus`/shared focus blocks and root event blocks.
- [x] Add blank-line separation around section comments before following focus blocks.
- [x] Keep nested short inline blocks untouched while applying structural spacing.
- [x] Confirm the TFR Korea focus preview now adds Kaiserreich-style focus block spacing in memory only.

Formatter inline block standardisation 2026-04-29:
- [x] Collapse simple multiline effect blocks such as `country_event = { id = korea.52 }`.
- [x] Keep multiline-preferred blocks such as `limit`, `every_country`, `completion_reward`, and `focus` expanded.
- [x] Cover the Kaiserreich-style inline effect case with formatter regression tests.

Kaiserreich formatter recheck 2026-04-29:
- [x] Re-scan Kaiserreich script files for inline vs simple multiline block style.
- [x] Narrow automatic collapse to inline-preferred effect/condition/scope blocks after finding focus graph blocks are commonly multiline.
- [x] Keep `prerequisite`, `mutually_exclusive`, and generic `trigger` blocks expanded unless already inline in source.

Formatter event call inline collapse 2026-04-29:
- [x] Collapse short multi-line event calls such as `country_event = { id = korea.535 days = 60 }`.
- [x] Keep the collapse limited to simple body lines with no comments or nested multiline blocks.
- [x] Avoid applying multi-body collapse to generic scope condition blocks such as multi-line `FROM`.

Formatter total review 2026-04-29:
- [x] Re-check formatter provider registration, path classifier, activation events, and Kaiserreich read-only sweep.
- [x] Align contextual activation globs with formatter-supported `common`, `events`, `history`, `country_metadata`, and nested GUI/GFX paths.

Focus Tree Preview responsiveness refactor 2026-04-30:
- [x] Add stage-level render metrics for loader, localisation, icon style, focus template, inlay style, and inlay rendering.
- [x] Keep deferred first render lightweight by skipping full localisation and asset-heavy icon/inlay work until hydration.
- [x] Schedule full hydration only after the deferred snapshot is posted to avoid first-paint CPU contention.
- [x] Coalesce external dependency refresh bursts by preview document URI and use a short document-edit debounce for Focus Tree Preview.
- [x] Reverify deferred localisation/icon behavior, deferred hydration ordering, and dependency coalescing with focused tests.

Review note: deferred Focus Tree first paint now renders the focus structure with placeholder icon styles and no full localisation lookup, then schedules full hydration after the first snapshot reaches the webview. External dependency changes are coalesced per preview instead of per changed file, and trace state now includes stage-level render and patch metrics for before/after performance inspection. Reverified with focused Focus Tree/PreviewManager mocha coverage, `npm run compile-ts`, `npm run lint`, `npm run test:unit`, `npm run test-ui`, and `git diff --check`.
