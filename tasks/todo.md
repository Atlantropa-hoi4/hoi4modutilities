Preview/editor audit and feature research 2026-05-30:
- [x] Map preview/editor entry points and existing high-risk guidance.
- [x] Fix overlapping mod-root dependency watcher rebuilds so stale async results cannot replace the newest watcher set.
- [x] Reverify with targeted preview-manager coverage, TypeScript checks, lint, and whitespace checks.
- [x] Research recent HOI4 modding community pain points and similar GitHub projects.
- [x] Package findings and feature recommendations into DOCX and XLSX deliverables.

Review note: `PreviewManager` mod-root watcher rebuilds now use a generation token so stale async results cannot replace the newest watcher set, and stale watcher instances are disposed. External research and benchmark recommendations were packaged in `outputs/preview-editor-audit/hoi4_preview_editor_audit.docx` and `outputs/preview-editor-audit/hoi4_preview_editor_feature_backlog.xlsx`. Reverified with `npm run compile-tests`, targeted `npx mocha out/test/unit/previewmanager.test.js`, `npm run compile-ts`, `npm run lint`, spreadsheet render/error scan, DOCX structural inspection, and `git diff --check`. DOCX PNG render could not run because `soffice` was not installed.

Preview/editor bottleneck remediation 2026-05-30:
- [x] Reconfirm P1/P2 bottleneck candidates from the generated audit document.
- [x] Add DDS/TGA custom editor preview size limits, progress feedback, and decode/encode payload metrics.
- [x] Add World Map retained-state diagnostics and postMessage payload-byte metrics for retained preview panels.
- [x] Reduce duplicate selected mod-root dependency watchers already covered by workspace watchers and record rebuild counts.
- [x] Surface Focus Tree dynamic/scripted localisation token limitations as preview warnings.
- [x] Reverify changed behavior with targeted tests, TypeScript checks, lint, and whitespace checks.

Review note: DDS/TGA custom editors now reject oversized image previews before extension-host decode/PNG work, World Map exposes hidden retained-state diagnostics like Focus Tree, selected mod roots inside existing workspaces skip duplicate broad watchers, and Focus Tree previews warn when resolved localisation still contains dynamic/scripted tokens. Reverified with `npm run compile-tests`, targeted `npx mocha out/test/unit/previewmanager.test.js out/test/unit/focustree-contentbuilder.test.js out/test/unit/image-preview-limits.test.js`, `npm run compile-ts`, `npm run lint`, and `git diff --check`.

Focus tree branch relative_position_id anchor 2026-05-26:
- [x] Trace the focus-link edit path from webview selection to source text update.
- [x] Resolve the relative anchor through the selected parent branch root instead of the immediate parent.
- [x] Reverify with focused Focus Tree position/relation tests, TypeScript checks, lint, and whitespace check.

Review note: focus link edits now keep prerequisite targets as the selected parent focuses, but resolve `relative_position_id` to the top focus of the selected parent's branch before writing source text or updating the live preview. Reverified with `npm run compile-tests`, targeted Focus Tree relation/position mocha coverage, `npm run compile-ts`, `npm run lint`, and `git diff --check`.

Focus tree continuous focus position edit 2026-05-26:
- [x] Trace the continuous focus edit path from webview drag coordinates to document update.
- [x] Normalize restored preview zoom before coordinate math so corrupted tiny scale values cannot amplify drag deltas into huge `continuous_focus_position` values.
- [x] Reverify with focused scale coverage, Focus Tree position edit coverage, TypeScript checks, lint, and whitespace check.

Review note: restored preview zoom is now clamped before initial rendering and every Focus Tree coordinate calculation that divides pointer movement by scale, preventing stale tiny scale state from turning a normal continuous-focus drag into a huge document coordinate. Reverified with `npm run compile-tests`, targeted `previewscale` and `focustree-positionedit` mocha coverage, `npm run compile-ts`, `npm run lint`, `npm run build:dev`, `npm run test-ui`, and `git diff --check`.

GFX UI Shader Preview removal 2026-05-26:
- [x] Remove the `.gfx` shader preview panel, trigger buttons, model JSON injection, and WebGL webview entry.
- [x] Delete the UI shader parser/model/resolver/classifier modules and their dedicated tests.
- [x] Restore preview dependency watching to non-shader assets.

Review note: `.gfx` preview is back to sprite image browsing only, using the existing sprite parser and `gfx.js` navigation script without shader metadata or WebGL preview code.

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

Codebase performance instrumentation 2026-04-30:
- [x] Add a shared local perf collector for async/sync durations and hit/miss counters.
- [x] Instrument preview orchestration, Focus Tree snapshot/patch posting, file loading, index builds, image/GFX caches, and worldmap load/diff/message paths.
- [x] Surface recent perf entries and counters from the Focus Tree debug state without adding production telemetry.
- [x] Add Focus Tree webview timing summaries for first content apply, rebuild, and hydration milestones.
- [x] Record approximate Focus Tree update payload sizes for full/partial snapshots and postMessage calls.
- [ ] Capture real cold open, warm reopen, document edit refresh, and dependency refresh before/after numbers from a representative workspace.

Character preview 2026-05-04:
- [x] Add a `common/characters/*.txt` preview provider for character portrait cards.
- [x] Parse character ids, names, and all `large`/`small` portrait variants while preserving source order.
- [x] Make portrait clicks navigate to the character block start.
- [x] Add fixture and targeted unit coverage for detection, parsing, rendering, and missing portraits.
- [x] Support direct portrait image paths such as `large = "gfx/Leaders/ZZZ/ZZZ_anarchy.png"`.
- [ ] Extend optimization fixes beyond Focus Tree once the new metrics rank the next bottlenecks.

Focus Tree loading measurement note 2026-05-01: debug state now exposes host perf entries plus `webviewTimings`, including `load`, `contentUpdateReceived`, `firstContentApplied`, `hydrationApplied`, and `webviewReady` stages. Representative fixtures remain `common/national_focus/preset-smoke.txt` and `GXC focus (Liangguang).txt`; real workspace before/after capture is still pending because it needs a manual cold/warm run against a representative mod workspace.

Review note: this pass keeps previous Focus Tree fast-path changes intact and adds local-only measurement hooks across the wider extension. Set `HOI4MU_PERF_TRACE=1` to mirror metric entries to debug logs, or use the Focus Tree debug command to inspect the latest `performance` snapshot. Reverified with `npm run compile-ts`, targeted perf/preview/index/worldmap mocha coverage, `npm run lint`, full `npm run test:unit`, `npm run build`, and `git diff --check`.

Fileloader refresh coalescing 2026-04-30:
- [x] Use the collected perf trace to identify `fileloader.list` and concurrent `fileloader.read` as the dominant refresh bottleneck.
- [x] Coalesce identical in-flight `readFileFromModOrHOI4` and `listFilesFromModOrHOI4` calls without persisting stale file-list results after completion.
- [x] Add `fileloader.read.inflightHit` and `fileloader.list.inflightHit` counters so the next trace can confirm duplicate work is being absorbed.

Review note: the user trace showed Focus Tree render/update stages in single-digit milliseconds after the initial base state, while file loading/listing repeatedly reached multi-second durations during hydration and edit refresh bursts. The first optimization keeps cache lifetime limited to the active Promise only, preserving file-change correctness better than a broad TTL cache. Reverified with `npm run compile-ts`, targeted fileloader/perf/preview mocha coverage, `npm run lint`, and full `npm run test:unit`.

Index build read throttling 2026-04-30:
- [x] Re-check the follow-up trace after in-flight coalescing.
- [x] Identify remaining bottleneck as high-cardinality `fileloader.read` bursts during localisation/GFX/shared-focus index builds.
- [x] Add a small shared concurrency helper and limit index build file reads to 8 concurrent files per index target.
- [x] Cover the concurrency helper with unit tests.

Review note: `fileloader.list` improved after coalescing, but the next trace still showed hundreds of different `fileloader.read` calls completing in large multi-second waves. Localisation, GFX, and shared-focus index builders now avoid unbounded `Promise.all` fan-out, which should reduce extension-host and disk I/O saturation during Focus Tree hydration without changing index contents or invalidation semantics. Reverified with `npm run compile-ts`, targeted index/preview/perf mocha coverage, `npm run lint`, full `npm run test:unit`, `npm run build`, and `git diff --check`.

Global file read pressure limit 2026-04-30:
- [x] Re-check the trace after per-index read throttling.
- [x] Identify remaining read waves as multiple index builders still running concurrently.
- [x] Add a fileloader-level 12-read global concurrency cap with `fileloader.read.queued` counters and `fileloader.read.wait` timings.

Review note: index-level throttling reduced the first wave, but several indexes can still overlap during Focus Tree hydration. The fileloader now caps aggregate `readFileFromModOrHOI4` pressure, so preview responsiveness should degrade more gracefully under localisation/GFX/shared-focus background work. Reverified with `npm run compile-ts`, targeted fileloader/preview/perf mocha coverage, `npm run lint`, full `npm run test:unit`, `npm run build`, and `git diff --check`.

Focus Tree ready-only localisation 2026-04-30:
- [x] Re-check trace after the global file read pressure limit.
- [x] Identify localisation text resolution as a remaining path that can force full localisation index build during Focus Tree hydration.
- [x] Make Focus Tree full and partial render use only ready localisation data, avoiding a blocking `getLocalisedTextQuick` index ensure on the preview render path.
- [x] Cover the ready-only resolver with focused unit coverage.

Review note: Focus Tree preview now keeps using already-built localisation when available, but no longer waits for localisation indexes to finish before posting full hydration or partial focus HTML patches. Missing localisation can still appear on later refreshes after the background index is ready. Reverified with `npm run compile-ts`, targeted Focus Tree/localisation/perf mocha coverage, `npm run lint`, full `npm run test:unit`, `npm run build`, and `git diff --check`.

Focus Tree delayed hydration 2026-04-30:
- [x] Re-check trace after ready-only localisation.
- [x] Identify immediate full deferred hydration as the remaining source of post-first-paint file read/list pressure.
- [x] Delay full hydration until after the deferred snapshot has been posted, and cancel stale scheduled hydration when newer document refreshes arrive.
- [x] Make ordinary document/dependency refreshes use the deferred path first, while structural/local edit commands can still request full refresh explicitly.

Review note: the latest trace showed `preview.show`, deferred base state, patch planning, snapshot build, and postMessage in the low millisecond range, followed by a large `fileloader.read.wait` wave from immediate full hydration. Full hydration now starts after a short delay instead of during first paint, so the initial UI should stay responsive and repeated edits should replace stale hydration work. Reverified with `npm run compile-ts`, `npm run compile-tests`, and targeted Focus Tree preview session mocha coverage.

Focus Tree interface GFX lazy scan 2026-04-30:
- [x] Re-check trace after delayed hydration.
- [x] Identify the remaining hydration read wave as likely `interface` GFX fallback cache construction.
- [x] Split the Focus Tree interface GFX cache into a cheap file-list cache and per-file lazy sprite-name parsing.

Review note: `getCachedInterfaceGfxFiles()` no longer parses every `.gfx` file when fallback icon/inlay resolution starts. Sprite names are now loaded per candidate file through `getCachedInterfaceGfxSpriteNames(file)`, allowing existing fallback loops to stop as soon as unresolved names are found instead of paying the full interface GFX parse cost up front.

Focus Tree icon fallback scan bound 2026-04-30:
- [x] Re-check trace after lazy interface GFX parsing.
- [x] Identify remaining multi-second full hydration as Focus icon fallback scanning with many unresolved names.
- [x] Prioritize `interface/goals.gfx` and goals/focus-like GFX files before other interface files.
- [x] Bound Focus icon fallback scanning so unresolved custom icons fall back to the default icon instead of forcing a broad interface scan.

Review note: full hydration still resolves indexed/known Focus icon GFX files, but fallback scanning is now capped after the most likely Focus icon GFX files. This trades exhaustive custom-icon discovery for predictable preview responsiveness; unresolved icons already use the existing default icon path.

Focus Tree local edit deferred refresh 2026-04-30:
- [x] Re-check trace after fallback scan bounding.
- [x] Identify stale multi-second builds as local edit reconciliation still requesting full asset loading.
- [x] Make optimistic local edit reconciliation use the deferred snapshot path while keeping structural edit reloads on full refresh.

Review note: repeated position edits can now update the preview through the same fast deferred snapshot path as ordinary document refreshes, avoiding a full Focus Tree loader for every optimistic local edit. Structural edits still force full refresh because they can change tree topology and dependency state.

Focus Tree deferred dependency propagation 2026-04-30:
- [x] Re-check trace after local edit deferred refresh.
- [x] Identify shared focus dependency loaders as still defaulting to full asset loading inside deferred refreshes.
- [x] Add a deferred Focus Tree dependency loader so shared/joint focus dependency loads inherit the parent deferred asset mode.
- [x] Cover deferred vs full shared-focus dependency behavior with focused loader tests.

Review note: deferred Focus Tree loads now keep shared focus dependency parsing structural-only instead of resolving icons/inlays for every optimistic edit. Full hydration still uses the regular Focus Tree loader for dependencies, preserving complete asset discovery after the delayed hydration pass.

Focus Tree temporary parse-error handling 2026-04-30:
- [x] Re-check trace after deferred dependency propagation.
- [x] Identify temporary invalid edit states as `UserError` parse failures escaping the document refresh promise.
- [x] Keep `UserError` refresh failures inside the Focus Tree session trace instead of surfacing unhandled rejected promises.
- [x] Cover document refresh parser errors with Focus Tree preview session unit coverage.

Review note: incomplete text while typing, such as a half-written assignment, now records a `refreshWithSnapshotFailed` trace and leaves the current preview intact. Non-user/programmer errors still rethrow so real defects are not hidden.

Focus Tree stale refresh cancellation 2026-04-30:
- [x] Re-check trace after temporary parse-error handling.
- [x] Identify discarded multi-second refreshes as stale base-state builds that kept loading until completion.
- [x] Propagate refresh cancellation from the preview session into the Focus Tree loader session.
- [x] Add cancellation checks around dependency loads, full asset resolution, icon fallback scanning, and texture expiry reads.
- [x] Cover stale refresh cancellation with Focus Tree preview session unit coverage.

Review note: older refreshes now observe newer request ids or document versions while they are still building, then stop through the existing `UserError` refresh-failure path instead of continuing to expensive full hydration only to be skipped afterward.

0.13.7 release prep 2026-04-30:
- [x] Check package and lockfile version metadata for `0.13.7`.
- [x] Compare the current changelog against commits after the first 0.13.7 versioning commit.
- [x] Refresh README feature and performance notes for formatter and Focus Tree responsiveness work.
- [x] Group the release commit story into user-visible changelog sections.
- [x] Run release verification after documentation review.

Release note: `0.13.7` now groups the post-versioning commit range into formatter, Focus Tree responsiveness/live refresh, parser/localisation compatibility, preview visibility, icon dependency, and webview hardening notes. README now advertises the formatter and the current Focus Tree first-paint/perf-trace behavior.

Focus Tree explicit icon GFX fallback 2026-04-30:
- [x] Re-check recent icon resolution refactor against previously working custom `.gfx` dependencies.
- [x] Prioritize explicitly declared focus/shared-focus `.gfx` dependencies before the bounded fallback scan.
- [x] Use the full GFX index during full asset loading so icons can resolve without `#!gfx` headers.
- [x] Restore unbounded full fallback scanning for non-indexed custom icons such as `interface/Meowl/MEO_goals.gfx`.
- [x] Cover priority fallback behavior with focused resolver unit coverage.

Review note: full asset loading now consults the GFX index, checks explicit `.gfx` dependencies first, and no longer bounds the fallback scan for non-indexed custom focus icons. This restores discovery for `#!gfx`-less files such as `interface/Meowl/MEO_goals.gfx`, while deferred first render still avoids asset work. Reverified with focused icon resolver/loader tests, `npm run compile-ts`, `npm run lint`, and `git diff --check`.

Focus Tree late icon/localisation display 2026-04-30:
- [x] Let deferred first render use already-ready localisation data without blocking on index builds.
- [x] Queue a full Focus Tree refresh when localisation indexes finish after the deferred render.
- [x] Shorten delayed full hydration so Focus icons leave placeholders sooner after first paint.
- [x] Reverify with focused Focus Tree/localisation tests plus standard compile/lint checks.

Review note: deferred Focus Tree snapshots now use ready-only localisation lookups instead of always suppressing text, and open previews queue a full refresh once localisation indexes finish if they were not ready during first paint. Full hydration starts after 250ms instead of 1200ms so Focus icon placeholders are replaced sooner while preserving the lightweight first snapshot. Reverified with targeted Focus Tree/localisation mocha tests, `npm run compile-ts`, `npm run lint`, `npm run test:unit`, `npm run build`, and `git diff --check`.

TFR-Korea real-mod Focus Tree smoke 2026-04-30:
- [x] Run Focus Tree loader/render smoke against `TFR-Korea/common/national_focus/TFR_national_focus_KOR.txt`.
- [x] Identify and fix fileloader read-slot leakage after queued large-mod index reads.
- [x] Add regression coverage for queued file reads releasing slots.
- [x] Reverify with targeted fileloader/Focus Tree tests plus standard compile/lint/unit/build checks.

Review note: TFR-Korea cold deferred render handled 635 focuses in roughly 67ms base + 10ms payload, but index prewarm exposed a queued `readFileFromModOrHOI4` slot leak that could stall subsequent preview reads indefinitely. The fileloader now transfers an existing active slot to the next queued read instead of incrementing the active count again. After the fix, TFR-Korea warm deferred render completed in roughly 36ms base + 8ms payload with 317 localized focus labels, and full hydration completed in roughly 197ms base + 742ms payload with 514 resolved icon names and 524 icon background images.

Focus Tree default index prewarm 2026-04-30:
- [x] Confirm TFR-Korea workspace does not set `hoi4ModUtilities.featureFlags`.
- [x] Enable `gfxIndex` and `localisationIndex` without requiring feature flags.
- [x] Register preview index prewarm during extension index service activation.
- [x] Use full initial Focus Tree snapshots when localisation indexes are already prewarmed.
- [x] Reverify manifest/default settings plus standard compile/lint/unit/build checks.

Review note: real TFR-Korea testing differed from the smoke setup because the workspace had no feature flags, while the smoke explicitly enabled `gfxIndex` and `localisationIndex`. The extension now enables those indexes without requiring opt-in flags and actually registers the existing prewarm timer, so large-mod previews can have GFX/localisation data ready before the Focus Tree panel requests its first content. If localisation indexes are already ready at panel initialization, Focus Tree now sends a full initial snapshot instead of a deferred placeholder snapshot. In the default-setting TFR smoke, `featureFlags` stayed `[]` while `gfxIndex` and `localisationIndex` were enabled, and the first full content snapshot produced 317 localized labels plus 524 icon background images.

Focus Tree TFR localisation fallback 2026-04-30:
- [x] Confirm `TFR-Korea/.vscode/settings.json` does not set `hoi4ModUtilities.previewLocalisation`.
- [x] Add workspace-language fallback when requested language and English localisation are missing.
- [x] Cover Korean-only workspace fallback with localisation index unit coverage.

Review note: TFR-Korea has no `previewLocalisation` workspace override, so the extension defaulted to `English`; for Korean-only focus keys this made the localisation index return the unresolved key even though `l_korean` entries were indexed. Localisation resolution now falls back to any available workspace language after requested-language and English lookups fail, so Korean-only mod workspaces can still display text without per-workspace preview language setup. Reverified with targeted localisation/Focus Tree tests, `npm run compile-ts`, `npm run lint`, `npm run test:unit`, `npm run build`, and `git diff --check`.

Event Tree preview usability 2026-05-03:
- [x] Add direct event/option node navigation back to the source location.
- [x] Remove the right-side inspect detail panel.
- [x] Add event preview search with previous/next match navigation.
- [x] Render event chains left-to-right and stack independent root chains downward.
- [x] Hide connector lines behind event/option cards so links do not cross card text.
- [x] Reverify with TypeScript checks and targeted build output review.

Review note: Event Tree preview keeps the search toolbar and delayed-edge dashed connections, but removes the right-side inspect panel. Event and option nodes now navigate directly to their source token on click/keyboard activation, matching the requested simpler interaction. Chains now grow left-to-right while independent root chains stack downward, and opaque event/option card backgrounds keep connector lines from visually crossing text. Reverified with `npm run compile-ts`, `npm run build`, `npm run lint`, `npm run compile-tests`, targeted event mocha tests, and `git diff --check`.

Event Graph mode 2026-05-03:
- [x] Add JSON-safe EventGraphData with event, option, missing-event nodes and delayed edge metadata.
- [x] Add Tree/Graph toolbar controls with local graph depth and center actions.
- [x] Render an Obsidian-style SVG local graph with pan, zoom, node drag, search-centering, and source navigation.
- [x] Add graph mode localisation strings and focused graph data unit coverage.
- [x] Reverify with compile, lint, build, targeted event tests, UI smoke tests, and diff checks.

Review note: Event preview now keeps Tree as the default mode and adds a Graph mode backed by a pure EventGraphData builder. The webview renders a capped depth-2 local SVG graph by default, with depth 1/2/3 controls, Center, wheel zoom, drag pan, node drag, delayed dashed edges, search-driven centering, and click/keyboard source navigation. Reverified with `npm run compile-ts`, `npm run lint`, `npm run build`, `npm run compile-tests`, targeted event mocha tests, `npm run test-ui`, and `git diff --check`.

Event preview loading speed 2026-05-03:
- [x] Defer EventGraphData construction until the user opens Graph mode.
- [x] Serve Graph mode data through a cached loader-backed webview request using the current document text.
- [x] Make graph data localisation lookup synchronous from the loader localisation dictionary.
- [x] Cache repeated localisation index lookups during Tree HTML rendering.
- [x] Reverify with compile, lint, build, targeted event tests, UI smoke tests, and diff checks.

Review note: Event preview no longer builds or embeds the full graph payload before first Tree render. Graph mode requests EventGraphData only when opened, while Tree rendering reuses a per-render localisation cache to avoid repeated async lookups for duplicate event, option, and missing-event labels. Reverified with `npm run compile-ts`, `npm run lint`, `npm run build`, `npm run compile-tests`, targeted event mocha tests, `npm run test-ui`, and `git diff --check`.

Event Graph overview 2026-05-03:
- [x] Confirm default Graph mode was falling back to one root/local component when no search match existed.
- [x] Render an all-root overview when Graph mode has no active search-centered node.
- [x] Keep search results as the local graph center when a current match exists.
- [x] Reverify with TypeScript checks, build, targeted event tests, UI smoke tests, and diff checks.

Review note: The default Graph view now seeds the visible graph from all root events when there is no active search result, while search-current nodes still switch the graph back to a capped local neighborhood. Overview root nodes also use a non-overlapping initial radial layout instead of stacking every depth-0 node at the center. Reverified with `npm run compile-ts`, `npm run lint`, `npm run build`, `npm run compile-tests`, targeted event mocha tests, `npm run test-ui`, and `git diff --check`.

Preview localisation setting priority 2026-05-03:
- [x] Confirm Focus and Event preview text uses `getLocalisedTextQuick*` for visible localisation.
- [x] Keep `hoi4ModUtilities.previewLocalisation` language ahead of fallback languages in quick preview localisation.
- [x] Prevent configured preview localisation from falling through to unrelated workspace languages.
- [x] Reverify with localisation and preview-focused unit checks plus standard TypeScript/static checks.

Review note: Preview-facing quick localisation now resolves the configured preview language first, then English fallback, and stops before the broad "any available workspace language" fallback so visible Focus/Event preview text cannot ignore the configured preview language. Reverified with `npm run compile-ts`, `npm run lint`, `npm run compile-tests`, targeted localisation/Focus/Event mocha tests, `npm run build`, `npm run test-ui`, and `git diff --check`.

Event preview hover picture bounds 2026-05-03:
- [x] Confirm event hover pictures were positioned from the event card without viewport bounds checks.
- [x] Clamp hover picture position inside the visible viewport.
- [x] Scale oversized hover pictures down to fit the viewport while preserving aspect ratio.
- [x] Reverify with TypeScript checks, lint, build, UI smoke tests, and diff checks.

Review note: Event hover pictures now render as fixed overlays, measure their actual size after insertion, and clamp or scale their display box so the preview remains visible inside the webview window. Reverified with `npm run compile-ts`, `npm run lint`, `npm run build`, `npm run test-ui`, and `git diff --check`.

Event Graph mode removal 2026-05-03:
- [x] Remove the Event preview Graph toolbar controls and graph webview container.
- [x] Remove the webview SVG graph renderer and eventGraphData message path.
- [x] Remove EventGraphData builder code, graph-only localisation strings, and graph-specific unit tests.
- [x] Reverify with TypeScript checks, lint, build, targeted event tests, UI smoke tests, and diff checks.

Review note: Event preview is back to a Tree-only preview while keeping direct source navigation, search, left-to-right tree layout, and bounded hover pictures. Reverified with `npm run compile-ts`, `npm run lint`, `npm run build`, `npm run compile-tests`, targeted event/localisation mocha tests, `npm run test-ui`, and `git diff --check`.

Preview localisation config read fix 2026-05-03:
- [x] Confirm the visible setting can be Korean while code still reads the default English value.
- [x] Read `hoi4ModUtilities` settings through `WorkspaceConfiguration.get(...)` before direct object properties.
- [x] Add regression coverage that `previewLocalisation: Korean` resolves to `l_korean` even when direct properties disagree.
- [x] Reverify with TypeScript checks, lint, targeted unit tests, build, UI smoke tests, and diff checks.

Review note: The shared configuration helper now resolves extension settings through VS Code's configuration API, so Focus/Event preview localisation uses the value shown in Settings instead of falling back to the extension default. Reverified with `npm run compile-ts`, `npm run compile-tests`, targeted vsccommon/localisation/event mocha tests, `npm run lint`, `npm run build`, `npm run test-ui`, and `git diff --check`.

Flag auto resize command 2026-05-04:
- [x] Port `FlagAutoResizer.py` behavior into a VS Code command without adding a new production dependency.
- [x] Generate missing `medium` 41x26 and `small` 10x7 `.tga`/`.png` flags from a selected or discovered flags folder.
- [x] Add command contribution, package/runtime localisation, command registration, and focused unit/manifest coverage.
- [x] Reverify with TypeScript checks, targeted tests, lint/build checks, and diff checks.

Review note: The new command is exposed as `server.hoi4modutilities.resizeFlags`, infers a `gfx/flags` folder from the active resource or workspace, and preserves existing generated files instead of overwriting them. Reverified with `npm run compile-ts`, `npm run compile-tests`, targeted flag/manifest mocha tests, `npm run lint`, `npm run build`, `npm run test-ui`, and `git diff --check`.

Feature audit 2026-05-05:
- [x] Dispatch feature-scoped subagent audits from the current feature catalog.
- [x] Review shared activation, contribution, preview, index, and webview contracts for cross-feature regressions.
- [x] Run the narrowest useful baseline validation.
- [x] Consolidate findings with changed files, verification, and remaining risk.

Review note: Audited all current feature catalog modules with feature-scoped subagents plus direct shared-path review. Baseline `npm run compile-ts` and `npm run lint` passed. The highest-priority follow-ups cluster around localisation/fileloader correctness, preview HTML/attribute safety, asset/dependency refresh gaps, long-running world-map session versioning, and thin smoke-test coverage for several previews.

P1 fix note 2026-05-05:
- [x] Preserve same-language localisation entries by rebuilding the workspace index from per-file localisation indexes.
- [x] Apply `replace_path` to descendant paths so HOI4 fallback is blocked for replaced subtrees.
- [x] Escape Event preview visible text and preserve Focus Tree selected tree during partial patches.
- [x] Guard Technology cross-folder XOR groups and recursive Reference scans.
- [x] Version World Map load/chunk messages and use fresh loaders for new load generations.
- [x] Prioritize GUI-declared GFX files for sprite lookup and sanitize sprite-derived style keys.
- [x] Reverify with TypeScript checks, targeted mocha, lint, build, and full unit tests.

Review note: Resolved the P1 audit findings without broad feature redesign. The fixes add regression coverage for localisation per-file aggregation, `replace_path` descendant matching, and Focus Tree partial selection preservation; broader webview/UI race behavior was verified with compile/build/unit coverage rather than a VS Code UI smoke run.

Memory reduction 2026-05-08:
- [x] Identify world map and eager preview index prewarm as the main memory pressure points.
- [x] Use typed arrays for province pixel/visited maps and release transient world-map loader caches after building the final payload.
- [x] Delay preview index prewarm and avoid eager localisation index construction at startup.
- [x] Reverify with TypeScript checks, lint, and diff review.

Preview Map HOI4 1.18 syntax 2026-05-08:
- [x] Parse modern state `local_supplies`, `buildings_max_level_factor`, state/province buildings, demilitarized flags, controller, and dated history blocks.
- [x] Parse strategic region `weather`, `static_modifiers`, and preserve `naval_terrain`.
- [x] Replace the old Supply Area UI/config path with modern railways, supply nodes, local supplies, and building-derived supply node display.
- [x] Add focused parser regression coverage and refresh Preview Map strings/docs.

Review note: Preview Map now targets the local HOI4 Case Green 1.18.1 syntax for state and strategic-region data while leaving date selection out of the UI. The old `hoi4ModUtilities.enableSupplyArea` setting and Supply Area view/color controls were removed; `Show Supply` now renders railways, `map/supply_nodes.txt`, and province `supply_node` buildings.

Preview Map province source navigation 2026-05-08:
- [x] Store token ranges for each province id listed in a parsed state `provinces` block.
- [x] Let Province view double-click open the assigned state file at the matching province token, with state-block fallback when the token is unavailable.
- [x] Reverify with TypeScript checks, focused unit coverage, build, and diff whitespace checks.

Review note: Province double-click navigation is scoped to Preview Map webview behavior and reuses the existing `openfile` host path; the toolbar Open button behavior remains unchanged.

Preview Map loading performance 2026-05-09:
- [x] Reuse World Map loader caches across normal reloads while preserving generation cancellation.
- [x] Batch webview chunk application so full canvas redraws do not happen per chunk.
- [x] Memoize webview lookup maps and optimize province edge concatenation.
- [x] Reverify with focused tests, TypeScript checks, lint, build, and unit tests where feasible.

Review note: Preview Map normal reloads now keep the existing `WorldMapLoader` cache path unless an overlapping load requires an isolated loader, webview chunk receipt no longer emits a full world map per chunk, common lookup maps are memoized per frontend map instance, and province edge concatenation uses endpoint indexes instead of repeated list scans. Reverified with `npm run compile-ts`, focused World Map mocha tests, `npm run lint`, `npm run build`, and `npm run test:unit`.

Focus Tree pdxscript lint refresh 2026-05-13:
- [x] Align focus relation lint with current HOI4 national-focus semantics for external prerequisite and mutually exclusive references.
- [x] Report invalid `focus_tree.shared_focus` references that no longer resolve to shared/joint focus definitions.
- [x] Reverify with focused Focus Tree lint/schema tests plus TypeScript and lint checks.
