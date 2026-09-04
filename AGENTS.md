# AGENTS.md

These instructions apply to the entire repository. Also check for nested `AGENTS.md` files that apply to the files being changed.

## Project Overview

- **HOI4 Mod Utilities** is a desktop VS Code extension for Hearts of Iron IV modding. Its extension ID is `server.hoi4modutilities`, an independent fork of `chaofan.hoi4modutilities`.
- It provides previews and editing helpers for focus, event, and technology trees, MIOs, characters, ideas, decisions, GUI/GFX, and the world map. It also includes DDS/TGA custom editors, flag resizing, localisation, and formatting.
- The project uses strict TypeScript, esbuild, ESLint, and Mocha. The extension host and browser webviews are typechecked and bundled separately.
- The repository's development baseline is Node.js 20 and npm 10+. CI runs on `windows-latest`. Check `engines.vscode` in `package.json` and `@types/vscode` for the VS Code API baseline.
- Start with [README.md](README.md), the [Architecture Overview](docs/architecture/overview.md), and `package.json`. When documented feature lists differ from the implementation, use the current `src/features/catalog.ts` and build configuration as the source of truth.

## Working Rules

- Reply in Korean unless the user requests another language. Write new code and identifiers in English, and follow the edited file's existing indentation, quoting, and other style conventions.
- Check `git status --short` before editing. Change only what the request requires; avoid unrelated refactoring, wholesale formatting, or reverting user changes.
- Do not commit, push, deploy, publish, add a production dependency, or modify remote systems unless explicitly requested.
- Change extension IDs, publisher identity, public command IDs, configuration keys, dependency versions, and packaging metadata only when required by the task.
- Report changed files, checks actually run and their results, material verification omissions, and remaining risks. Do not present successful checks recorded in earlier task notes as verification of the current changes.
- Use the `computer-use` plugin and take full screenshots only when explicitly requested. An active goal must continue through alternative methods when `computer-use` cannot be used.

## Repository Map

| Path | Responsibility and edit location |
| --- | --- |
| `package.json`, `src/constants.ts` | Activation conditions, commands, menus, settings, custom editor and webview IDs |
| `src/extension.ts`, `src/features/`, `src/services/` | Activation, feature catalog, registrations, and service lifecycle |
| `src/hoiformat/` | Clausewitz/HOI4 script parsing, schema conversion, conditions, scopes, and formatting |
| `src/previewdef/` | Preview detection, shared base classes, sessions, dependency tracking, and feature-specific host logic |
| `src/previewdef/focustree/`, `src/previewdef/technology/` | Tree loading, render data, graph editing, and source text changes |
| `src/previewdef/worldmap/`, `webviewsrc/worldmap/` | Map data loading and editing, and browser canvas rendering |
| `webviewsrc/` | Browser preview entrypoints, interactions, state restoration, and host message handling |
| `src/util/fileloader.ts`, `src/util/modfile.ts`, `src/util/vsccommon.ts` | Mod, dependency mod, DLC, and game file resolution; VS Code URI and document access |
| `src/services/indexService.ts`, `src/util/` | Shared index lifecycle, GFX/localisation/shared-focus indexes, caches, and concurrency control |
| `src/ddsviewprovider.ts`, `src/util/image/`, `src/util/flagAutoResizer.ts` | DDS/TGA editors, image decoding, caching, size limits, and flag resizing |
| `resource/`, `src/previewdef/worldmap/worldmapview.html`, `src/previewdef/worldmap/worldmapview.css` | CSS, SVG, and HTML source assets to edit |
| `l10n/`, `i18n/`, `package.nls.json` | Runtime translations, legacy translation tables, and manifest strings |
| `test/unit/`, `test/integration/`, `test/fixtures/` | Mocha unit tests, VS Code integration tests, representative HOI4 files and workspaces |
| `scripts/build.mjs`, `.vscodeignore`, `.github/workflows/` | Bundle entrypoints and asset copying, VSIX inclusion rules, verification and release CI |

Use `docs/architecture/` and `tasks/` as references for design and work history. Modify `outputs/`, `demo/`, and `FOCUS_EXAMPLE/` only when the feature change requires updating those deliverables, demos, or examples. The extension's flag resizing implementation is `src/util/flagAutoResizer.ts`; the root `FlagAutoResizer.py` is excluded from the VSIX.

## Implementation Contracts

- **Feature registration:** Keep feature descriptors, editor registrations, and index registrations in `src/features/*` and `src/features/catalog.ts`. Keep `src/services/*` as assembly layers and preserve the catalog's preview priority. When adding or removing public features, check `package.json`, `src/constants.ts`, feature registrations, and tests together. Preserve contextual activation rather than introducing unnecessary startup-wide activation.
- **Host/webview boundary:** Runtime code in `webviewsrc` uses DOM and webview APIs. Keep payload, type, and pure computation modules shared from `src` free of runtime dependencies on `vscode`, file systems, image caches, and indexes. Use `import type` when only types are needed. esbuild's host-module stubs do not make those APIs available in the browser.
- **Preview lifecycle:** Handle opening, restoration, refresh, and disposal through `PreviewManager`, `PreviewBase`, session stores, and dependency trackers. Keep broad preview dependency watchers active only while previews are open, and dispose them when the last preview closes. Preserve generation checks and stale asynchronous result disposal when rebuilding mod-root watchers.
- **Messages and state:** Update both host payload producers and webview consumers when changing payloads. Preserve request IDs, document and snapshot versions, partial updates, and selection and zoom restoration. Reuse existing session, scheduler, and generation helpers so cancelled or stale loads cannot overwrite the current view.
- **Focus and technology editing:** Process webview requests through host edit handlers and existing text-edit services, applying changes with `vscode.WorkspaceEdit`. Verify that each user action remains one undoable operation, stale document versions are rejected, and BOMs, line endings, indentation, comments, and unrelated fields are preserved. Keep focus `relative_position_id`, prerequisite links, and rendered coordinates consistent.
- **Parsing and file resolution:** Reuse the existing parser, schemas, and `fileloader`. Preserve unsaved open-document content, workspace and selected/dependency mod precedence, `replace_path`, optional DLC loading, and base-game fallback. Use existing URI/path normalisation helpers and avoid hardcoded developer game paths. Check the effects of syntax changes on source positions and existing HOI4 fixtures.
- **Performance:** Preserve lazy loading, request coalescing, cancellation propagation, and bounded file-read and image-processing concurrency. Retain the focus tree's structural first paint followed by asset hydration, map bitmap typed arrays and frame batching, and image preview limits and cache bounds. Use `src/util/perf.ts` and `HOI4MU_PERF_TRACE=1` for measurement.
- **Webview HTML:** Use the shared helpers in `src/util/html.ts`, `src/util/htmlescape.ts`, and `src/util/webview.ts`. Preserve escaping of file and localisation strings, CSP, nonces, `asWebviewUri`, and restricted `localResourceRoots`.

## Localisation Changes

- Runtime UI translations use `vscode.l10n` through `src/services/localizer.ts` and `l10n/bundle.l10n*.json`. Webview `feLocalize` also looks up translations by the **English message text** in the injected bundle. Changing only the first legacy key argument to `localize`/`feLocalize` does not change the runtime translation.
- When adding or changing user-facing text, update the corresponding entries in the default, Korean, Russian, and Chinese bundles, preserving placeholders such as `{0}` and `{1}`. Check related `i18n/*.ts` tables and tests too, but do not update only those tables while omitting the runtime bundles.
- For manifest `%...%` strings, check `package.nls.json` and `i18n/package.nls.*.json`. Language-specific root `package.nls.*.json` files are ignored by Git, so editing those files alone is insufficient.
- The current build does not automatically generate or synchronise translation tables. `scripts/geni18n.js` and `scripts/genzhi18n.js` broadly rewrite legacy tables; do not run them as mandatory steps for normal builds or small wording changes.

## Build and Run

Run all commands from the repository root. When dependencies are needed, use `npm ci` to install from the lockfile.

| Command | Actual scope |
| --- | --- |
| `npm run compile-ts` | Typecheck the extension host and webviews without emitting JavaScript |
| `npm run check-types:extension` / `npm run check-types:webview` | Typecheck one runtime area |
| `npm run build` / `npm run build:dev` | Generate production/development bundles and copy static assets; does not perform typechecking |
| `npm run watch` | Run both typecheck watchers and the bundle watcher |
| `npm run lint` | Run TypeScript ESLint checks on `src`, `webviewsrc`, and `test` |
| `npm run compile-tests` | Clean `out/` and compile TypeScript for tests |
| `npm run test:unit` | Compile tests and execute `out/test/unit/**/*.test.js` |
| `npm run test` | Typecheck, production build, lint, then unit tests |
| `npm run test-ui` | Typecheck, build, and compile tests, then run desktop VS Code integration tests |
| `npm run package` | Run the `vscode:prepublish` build and create a local VSIX with `vsce package --no-dependencies` |
| `npm run verify` | Run the complete `test`, `test-ui`, and `package` sequence |

- `scripts/build.mjs` bundles `src/extension.ts` into `dist/extension.js` and webview entrypoints into `static/*.js`. It cleans `dist/` and `static/` before building. Register new webviews and static assets in its entrypoint and copy lists.
- `dist/`, `static/`, `out/`, `.vscode-test/`, and `*.vsix` are generated outputs. Edit sources and regenerate outputs with the appropriate commands instead of editing them directly. Do not concurrently run build, clean, or test compilation commands that share output directories.
- For manual verification, use VS Code's `Run Extension` configuration. Reload the Extension Development Host after changing webview or asset bundles before judging the result. `package.json` has no browser extension entrypoint; a leftover web-extension launch configuration does not establish support for web extensions.
- Previewing real mods may require `hoi4ModUtilities.installPath`. Check `hoi4ModUtilities.modFile` when multiple `.mod` descriptors are present. Prefer `test/fixtures/workspace` for tests.
- `npm run test-ui` uses stable VS Code as configured in `.vscode-test.mjs`; its first run may require a download and a desktop execution environment.
- Release CI publishes a GitHub Release when a `v*.*.*` tag matching the `package.json` version is pushed. Do not create tags, push, or publish releases merely to verify changes or create a local VSIX.

## Choosing Verification

Start small changes with the narrowest meaningful checks. Follow the existing Mocha and Node `assert` patterns in `test/unit/` and fixture helpers in `test/testUtils.ts`. For behavioural bugs, verify reproducing inputs and expected behaviour; avoid unnecessary tests that merely mirror the implementation.

Compile before running specific tests. For example:

```sh
npm run compile-tests
npx --no-install mocha --exit out/test/unit/parser.test.js out/test/unit/formatter.test.js
```

The following test names are relative to `test/unit/`. Execute their corresponding emitted `out/test/unit/*.test.js` files.

| Changed area | Tests to check first |
| --- | --- |
| Parser and formatter | `parser.test.ts`, `formatter.test.ts`, `formatter-provider.test.ts`, and the relevant feature's schema tests |
| File resolution, indexes, and caches | `fileloader.test.ts`, `modfile.test.ts`, `index-service.test.ts`, `workspace-index-watchers.test.ts`, and the relevant index/cache tests |
| Preview refresh, watchers, and restoration | `previewmanager.test.ts`, `previewdependencytracker.test.ts`, `previewbase.test.ts`, `preview-session-store.test.ts`, and feature-specific state tests |
| Focus tree editing and messages | `focustree-positionedit.test.ts`, `focustree-edithandler.test.ts`, `focustree-relationanchor.test.ts`, `focustree-messageapply.test.ts`, `previewscale.test.ts` |
| Technology tree editing | `technology-positionedit.test.ts`, `technology-edithandler.test.ts`, `technology-draginteraction.test.ts` |
| World map | `worldmap-provincebmp.test.ts`, `worldmap-payload.test.ts`, `worldmap-diff.test.ts`, `worldmap-framebatching.test.ts`, and the relevant loader tests |
| Images and flags | `dds.test.ts`, `ddsviewprovider.test.ts`, `image-preview-limits.test.ts`, `imagecache.test.ts`, `flag-auto-resizer.test.ts` |
| Translations, manifest, and packaging | `manifest.test.ts`, `preview-i18n-ko.test.ts`, `build-packaging.test.ts`; add `localisation-index.test.ts` for changes to game localisation parsing |

- For TypeScript changes, run the relevant typecheck and lint. For shared code, check both areas with `npm run compile-ts`.
- For webviews, activation, custom editors, or integrated editing behaviour, add a build and `npm run test-ui` to the relevant tests. If the execution environment is unavailable, report the reason and the behaviour left unverified.
- Verify packaging and bundle configuration changes with a production build and local packaging. Use `npm run verify` for broad changes. Do not repeat successful checks already covered by an aggregate command without a reason.
- For documentation-only changes, cross-check referenced paths and commands against the repository and run `git diff --check`. State that builds and tests were skipped.
- Before completion, review the diff and Git status for unrelated changes and fixture modifications left by tests.
