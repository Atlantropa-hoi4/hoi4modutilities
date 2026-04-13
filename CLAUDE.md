# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Desktop VS Code extension for Hearts of Iron IV modding (`server.hoi4modutilities`, forked from `chaofan.hoi4modutilities`). Workspace-kind extension (`extensionKind: ["workspace"]`) — desktop only, no web-extension build. Engine pin: `vscode ^1.110.0`.

## Common commands

Everything runs through npm scripts; the build is esbuild-driven via `scripts/build.mjs` (do not invoke `tsc` for emit — `tsc` is used only for `--noEmit` typechecks).

- `npm ci` — install
- `npm run compile-ts` — typecheck only (no emit)
- `npm run build` / `npm run build:dev` — production / development bundle into `dist/`
- `npm run lint` — ESLint over `src webviewsrc test` (`.ts` only)
- `npm run compile-tests` — emit tests to `out/` via `tsconfig.test.json`
- `npm run test:unit` — mocha against `out/test/unit/**/*.test.js`
- `npm run test` — typecheck + build + lint + unit tests (no VS Code host)
- `npm run test-ui` — VS Code integration tests via `@vscode/test-electron` (config in `.vscode-test.mjs`, uses `test/fixtures/workspace` as the workspace folder)
- `npm run package` — `vsce package --no-dependencies` → `.vsix`
- `npm run verify` — `test` + `test-ui` + `package` (the CI gate)

Single unit test: `npm run compile-tests && npx mocha --exit out/test/unit/<name>.test.js`. Tests only exist compiled — re-run `compile-tests` after editing a test file.

## Architecture

### Two TypeScript trees, one tsconfig

- `src/` — extension-host code (Node + `vscode` API). Entry: `src/extension.ts`.
- `webviewsrc/` — webview UI code (DOM context). Entry points match preview types: `focustree.ts`, `eventtree.ts`, `techtree.ts`, `worldmap/index.ts`, `gfx.ts`, `guipreview.ts`, `miopreview.ts`.
- `test/` — unit (`test/unit`) and integration (`test/integration`) sources plus `test/fixtures/`.

Both trees share `tsconfig.json` (`lib: [ES2022, DOM]`, `module: Node16`, `strict`). Tests use `tsconfig.test.json`. `scripts/`, `dist/`, `out/`, `static/` are excluded from tsc.

### Services wiring

`src/extension.ts` creates an `ExtensionServices` registry (`src/services/serviceRegistry.ts`) and calls each `register*Services` in a fixed order:

1. `registerContextContainer` (must be first — others depend on it)
2. `registerTelemetryServices`
3. `registerPreviewServices`
4. `registerEditorServices`
5. `registerIndexServices`
6. `registerCommandServices`

After wiring, `setVscodeContext(ContextName.Hoi4MULoaded, true)` gates menu visibility. New services should follow this pattern rather than subscribing directly in `activate`.

### Preview pipeline

Previews are the core feature surface. Each preview type lives under `src/previewdef/<type>/` (focustree, gfx, technology, worldmap, event, gui, mio) and exports a `PreviewDescriptor` aggregated by `src/previewdef/previewproviders.ts`. `PreviewManager` (`previewmanager.ts`) owns panel lifecycle, registers the `preview` command, the webview panel serializer, and document change listeners. `PreviewBase` is the abstract per-preview instance; `PreviewDependencyTracker` and `UpdateScheduler` handle debounced updates across dependent files.

Webview HTML/JS comes from the matching `webviewsrc/<type>.ts` bundle; messaging between host and webview is structured (see `webviewupdate.ts`, `webviewsrc/focustree/messageapply.ts`). Focus tree is the most modular — it splits content building, layout, rendering, edit handling, selection state, and render-payload patching into separate files; reuse that pattern when extending other preview types.

### Parsing / indexing

- `src/hoiformat/hoiparser.ts` parses Paradox script; `schema.ts` and preview-specific schema files (e.g. `focustreeschematypes.ts`) drive typed extraction.
- `src/util/` holds shared services: `gfxindex.ts`, `localisationIndex.ts`, `sharedFocusIndex.ts`, `modfile.ts`, `fileloader.ts` (resolves mod + HOI4 install paths with `replace_path`), plus `cache.ts` for lazy, cache-backed indexes.
- `src/services/indexes.ts` wires the index services; previews consume them via the services registry rather than constructing their own.

### Activation

Activation is intentionally narrow — see `activationEvents` in `package.json`. Expanding activation (adding globs or `onStartupFinished`) regresses cold-start cost on non-HOI4 workspaces; prefer a new `workspaceContains:` glob tied to a specific HOI4 path over broad triggers.

### Custom editors

`DDSViewProvider` and `TGAViewProvider` in `src/ddsviewprovider.ts` back `*.dds` and `*.tga` custom editors (`viewType` `server.hoi4modutilities.{dds,tga}`). They are not previews and bypass `PreviewManager`.

## Testing notes

- Unit tests are fixture-heavy (see `test/fixtures/{focus,events,localisation,parser,dependency,workspace}`). When adding parser / preview / localisation / activation behavior, add or extend fixtures rather than inlining strings.
- `test/fixtures/workspace` is the integration test workspace — it must look like a real HOI4 mod tree for activation globs to fire.
- The extension contributes a `server.hoi4modutilities.test` command gated on `server.hoi4MUInDev`; it is a dev-only hook, not a test runner.

## High-risk areas (from AGENTS.md)

Preview lifecycle, webview messaging, parser/index services, activation events, and packaging metadata (`package.json` contributions, `package.nls.json`, `l10n/`). Changes here should be narrowly scoped and fixture-backed.

## Localisation

UI strings use `%key%` placeholders resolved via `package.nls.json` (and locale variants). Runtime strings use `localize()` (`src/util/i18n.ts`) backed by `l10n/`. `i18n/` holds source catalogs; `scripts/geni18n.js` / `genzhi18n.js` regenerate them.

## Release

Tagged releases (`v<semver>` matching `package.json`) trigger `.github/workflows/release.yml` on `windows-latest`, which runs `npm run verify` and publishes the `.vsix` + checksum. `verify.yml` runs on PRs. Windows is the canonical build host — keep paths and scripts portable but test on Windows before tagging.

## Task tracking

For non-trivial multi-step work, update `tasks/todo.md` with a concrete checklist and a short review note (per AGENTS.md).
