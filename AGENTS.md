# AGENTS.md

Repository-local guidance for coding agents working in `server.hoi4modutilities`, a desktop VS Code extension for Hearts of Iron IV modding workflows.

## Scope

These instructions apply to the whole repository unless a nested `AGENTS.md` provides a more specific override.

## Repository Map

- `src`: extension-host TypeScript, activation, providers, services, parsers, indexers, utilities
- `webviewsrc`: webview entrypoints, preview UI, webview-side messaging
- `test`: unit, integration, UI tests, fixtures, fixture workspaces
- `scripts`: build, packaging, cleanup, verification helpers
- `static`, `demo`, `resource`, `i18n`, `l10n`: supporting assets and localisation resources
- `dist`, `out`: generated outputs; preserve unless the task explicitly requires rebuilding them

Primary entry points:

- `src/extension.ts`
- `src/features/catalog.ts`
- `src/ddsviewprovider.ts`
- `scripts/build.mjs`
- `webviewsrc/*.ts`
- `package.json`

## Operating Rules

- Keep edits tightly scoped to the requested behavior.
- Prefer root-cause fixes over symptom patches, but avoid unrelated refactors and scope creep.
- Do not break VS Code extension packaging, activation events, contributed commands, menus, keybindings, languages, custom editors, or webview contributions.
- Preserve generated outputs unless rebuilding them is explicitly part of the task.
- Do not change dependency versions, package metadata, publisher identity, extension IDs, or VSIX packaging behavior unless required.
- Use repository tools such as `rg`, `fd`, and `jq` where they make inspection safer or faster.
- Before changing behavior, identify the relevant entry point, contribution, service, fixture, or test path.
- Preserve lazy preview dependency watchers: broad workspace and selected-mod-root watchers should be created only for open previews and disposed when idle.

## High-Risk Areas

Treat these as requiring extra care and targeted verification:

- Extension activation and deactivation behavior in `src/extension.ts`
- Custom editor registration and lifecycle, especially `src/ddsviewprovider.ts`
- Preview lifecycle, disposal, state restoration, webview CSP, and webview messaging
- Preview dependency tracking and path normalisation across `src/previewdef/previewdependencytracker.ts`, preview content builders, and provider-specific dependency emitters
- Preview watcher orchestration in `src/previewdef/previewmanager.ts`, especially lazy dependency watcher lifetime, mod-root watcher rebuild generations, selected-mod-root watchers, stale async rebuild results, and retained preview panel diagnostics
- Focus Tree edit and live-preview paths across `webviewsrc/focustree.ts` and `src/previewdef/focustree/*`, especially `relative_position_id`, `relationanchor`, restored preview scale, dynamic/scripted localisation warnings, and partial update payloads
- DDS/TGA custom editor preview limits, progress feedback, and decode/encode payload metrics around `src/ddsviewprovider.ts` and `src/util/image/previewlimits.ts`
- Heavy preview caches, concurrency helpers, and file/image loader memory bounds across `src/util/cache.ts`, `src/util/common.ts`, `src/util/fileloader.ts`, and `src/util/image/imagecache.ts`
- World Map province bitmap memory/performance paths in `src/previewdef/worldmap/loader/provincebmp.ts`, especially typed-array color storage and edge compaction
- Parser, formatter, validation, and indexing services
- Localisation files and key usage across `i18n` and `l10n`
- Preview feature flags and GUI text rendering hooks across `src/util/featureflags.ts`, `src/previewdef/technology/contentbuilder.ts`, and `src/util/hoi4gui/instanttextbox.ts`
- `package.json` contributions, activation events, commands, views, custom editors, scripts, and packaging metadata
- Cross-boundary contracts between `src` and `webviewsrc`

## Testing Expectations

Prefer fixture-backed or targeted tests for changes involving:

- Parsing or syntax handling
- Preview rendering or preview lifecycle
- Webview messaging
- Localisation
- Formatting
- Activation behavior
- Indexing or workspace scanning
- Custom editor behavior

Use the narrowest meaningful verification first, then broaden when risk warrants it.

## Standard Commands

Recommended local environment:

- Node.js 20 LTS
- npm 10+
- Windows when matching the packaged release workflow matters

- Install dependencies: `npm ci`
- Type-check: `npm run compile-ts`
- Extension-host type-check only: `npm run check-types:extension`
- Webview type-check only: `npm run check-types:webview`
- Build: `npm run build`
- Development build: `npm run build:dev`
- Watch extension-host type-check, webview type-check, and bundles together: `npm run watch`
- Compile tests to `out`: `npm run compile-tests`
- Lint: `npm run lint`
- Unit tests: `npm run test:unit`
- Full tests: `npm run test`
- VS Code integration/UI tests: `npm run test-ui`
- Package VSIX: `npm run package`
- Inspect installed VS Code typings: `npm ls @types/vscode`
- Full verification: `npm run verify`
- Clean generated build/test output: `npm run clean`
- Clean only `dist` and `static`: `npm run clean:build`
- Clean only `out`: `npm run clean:out`
- Clean VS Code integration test downloads: `npm run clean:test-ui`

## Command Selection

- TypeScript-only changes: run `npm run compile-ts`; add `npm run lint` when style or static checks may be affected.
- While iterating locally, prefer `npm run watch`; the default VS Code build task runs `npm run build:dev`.
- For targeted test debugging, `npm run compile-tests` is the narrow compile step before running emitted tests from `out/test`.
- Run focused unit tests after `npm run compile-tests` with `npx mocha out/test/unit/<test-file>.test.js`; use multiple emitted test files when the behavior crosses fixtures or preview boundaries.
- Parser, formatter, localisation, indexing, or service changes: run targeted/unit tests and relevant fixture-backed tests.
- Parser token/position handling changes: run `npm run compile-tests` plus `npx mocha out/test/unit/parser.test.js`; include index consumers such as `out/test/unit/localisation-index.test.js` or Focus Tree/index tests when the parser change is for index-only loading.
- Localisation index parsing or fallback changes: run `npm run compile-tests` plus `npx mocha out/test/unit/localisation-index.test.js`; include Focus/Event preview tests when visible preview text can change.
- Feature flag changes: run `npm run compile-tests` plus `npx mocha out/test/unit/featureflags.test.js`; add provider-specific tests when a flag changes preview rendering.
- Preview dependency refresh fixes: inspect both the dependency producer and `PreviewDependencyTracker`, then run `npm run compile-tests` plus focused emitted tests such as `npx mocha out/test/unit/previewmanager.test.js` and provider-specific coverage like `out/test/unit/focustree-focusicongfx.test.js`.
- Preview watcher, selected mod-root, retained-panel diagnostics, or payload-metric changes: run `npm run compile-tests` plus focused emitted tests such as `npx mocha out/test/unit/previewmanager.test.js out/test/unit/focustree-contentbuilder.test.js`, then `npm run compile-ts`, `npm run lint`, and `git diff --check`. For watcher lifetime changes, include coverage that broad dependency watchers are absent before preview open and disposed after preview close.
- Focus Tree relation, drag, or position-edit changes: keep the webview-selected prerequisite and the written `relative_position_id` visually/source-text consistent; run `npm run compile-tests` plus focused emitted tests such as `npx mocha out/test/unit/focustree-relationanchor.test.js out/test/unit/focustree-positionedit.test.js out/test/unit/previewscale.test.js`, then `npm run compile-ts`, `npm run lint`, and `git diff --check`. Add `npm run build:dev` and `npm run test-ui` when bundled webview behavior is involved.
- DDS/TGA custom editor preview-limit or metrics changes: run `npm run compile-tests` plus `npx mocha out/test/unit/image-preview-limits.test.js`, then `npm run compile-ts`, `npm run lint`, and `git diff --check`.
- Heavy cache, loader memory-bound, concurrency-helper, or image-cache changes: run `npm run compile-tests` plus focused emitted tests such as `npx mocha out/test/unit/cache-metrics.test.js out/test/unit/common-concurrency.test.js`; add provider-specific preview tests when cache eviction or decode throttling can change rendered content.
- World Map province bitmap loading or edge construction changes: run `npm run compile-tests` plus `npx mocha out/test/unit/worldmap-provincebmp.test.js`; add broader World Map tests when loader payload shape or preview behavior changes.
- Webview, preview, activation, or custom editor changes: run targeted tests plus `npm run build:dev` and `npm run test-ui` when feasible. Reload or restart the Extension Development Host after changing bundled webview/static preview assets before judging live behavior.
- VS Code engine or API baseline changes: keep `package.json`, `package-lock.json`, and `@types/vscode` aligned; verify with `npm run compile-ts` and `npm ls @types/vscode`.
- Packaging, contribution, or metadata changes: run `npm run build` and consider `npm run package`.
- Broad or release-sensitive changes: run `npm run verify`.
- Before reporting completion, prefer `git diff --check` after manual edits to catch whitespace issues.

## Task Tracking

For non-trivial multi-step work, update `tasks/todo.md` with:

- Concrete checklist items
- The current implementation status
- A short review note describing what changed and what was verified

Keep task notes factual and concise.

## Change Discipline

- Avoid unrelated formatting churn.
- Avoid mass rewrites unless the task requires them.
- When the user asks to remove a feature entirely, search and remove the full surface: `src`, `webviewsrc`, `scripts`, `test`, generated `static/*` artifacts, and stale guidance/task notes. After removing a webview build entry, run `npm run build:dev` and confirm the bundle is absent from build output and `static/*`.
- Preserve existing public APIs and extension contribution contracts.
- Keep localisation keys stable unless the change explicitly requires migration.
- Keep fixtures minimal and representative.
- When touching generated artifacts, document why regeneration was necessary.

## Linked Guidance

Also consult, when present:

- `code_review.md`
- `docs/architecture/*.md`
- Nested `AGENTS.md` files for local overrides
