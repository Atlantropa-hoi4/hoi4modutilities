# HOI4 Mod Utilities

Desktop VS Code utilities for Hearts of Iron IV modding, maintained as the independent `server.hoi4modutilities` fork of the original `chaofan.hoi4modutilities` extension.

## What It Covers

- Focus tree preview and editing helpers, including GUI-defined focus items, `text_icon` titlebar styles, and continuous-focus windows
  - Use the **Focus frame GFX** and **Focus decoration GFX** toolbar buttons to toggle frames and decorations independently. Focus icons and labels stay visible, and the choices are saved with the preview.
- World map preview with country/localised views, bookmark-aware history, scaled export, warnings, and state/strategic-region editing
- Event tree preview with automatic cross-file event references and details for conditional descriptions, AI choice weights, and original-recipient restrictions
- Technology tree preview with country-specific icons and ID, technology-name, short-equipment-name, and full-equipment-name labels
- MIO preview
- GUI preview
- `.gfx` sprite preview
- `.dds` and `.tga` custom editors
- Localisation highlighting and preview text lookup
- HOI4 script, GUI, and GFX formatter support
- `HOI4 Mod Utilities: Format Workspace HOI4 Files` formats supported `.txt`, `.gui`, and `.gfx` files across all workspace folders, respecting VS Code `files.exclude` settings. It uses open documents, including unsaved changes, applies files in deterministic path order, skips files that fail parsing or semantic safety checks, and supports cancellation. The formatter preserves BOM and existing line-ending style, normalises code and comment indentation, removes trailing whitespace, and adds a final newline to non-empty files. Changes remain unsaved for review; use Save All to save them. Each changed file is an undoable edit. Localisation, map text files, and other unsupported text files are excluded according to the existing formatter rules. By default, vanilla files under `hoi4ModUtilities.installPath`, including DLC folders, and vanilla-derived mod folders are not formatted by the document, range, on-type, or workspace formatter; turn off `hoi4ModUtilities.skipVanillaFiles` to format them.
- `HOI4 Mod Utilities: Insert and Update Workspace Logs` applies the Kaiserreich logging conventions across `events`, `common/ideas`, `common/decisions`, and `common/national_focus`. It inserts missing event option/news/optionless-event logs and idea `on_add` logs, and synchronises generated logs in existing idea removal, decision effect, and focus effect blocks. Custom `log` statements are preserved. `#donotlog` targets, `hidden_ideas`, decision category definitions, operative-leader events, and absent decision/focus effect blocks are intentionally left unchanged. The command respects VS Code `files.exclude` and `hoi4ModUtilities.skipVanillaFiles`, reads unsaved documents, supports cancellation, and leaves one unsaved undoable edit per changed file for review.
- Editor lint diagnostics provide Quick Fixes for legacy `check_variable` syntax, redundant `ai_chance` blocks in single-option events, and localisation version markers such as `KEY:0`. `Source: Fix All` can apply all safe HOI4 lint fixes in the active file. By default, the same vanilla files still show diagnostics but get no fixes; turn off `hoi4ModUtilities.skipVanillaFiles` to fix them.

## Getting Started

1. Install the extension in desktop VS Code.
2. Set `hoi4ModUtilities.installPath` to your HOI4 install folder.
3. Open your mod workspace.
4. Optionally set `hoi4ModUtilities.modFile` if your workspace contains multiple `.mod` descriptors.
5. Use:
   - `HOI4 Mod Utilities: Preview HOI4 File`
   - `HOI4 Mod Utilities: Preview World Map`
   - the editor toolbar preview button on supported `.txt`, `.gfx`, `.gui`, and `map/default.map` files
   - direct open on `.dds` and `.tga`

## Performance Notes

- Activation is contextual now: the extension waits for HOI4-relevant files, custom editors, or preview panels instead of activating broadly at startup.
- Focus tree previews keep their webview context while hidden, so re-opening the same preview should avoid a full bootstrap.
- Focus Tree preview posts a lightweight structural snapshot first, then hydrates localisation, icons, and inlay data after first paint.
- Focus Tree asset hydration prepares on-screen focuses first, then nearby focuses and other trees on demand. Scrolling, zooming, and revealing conditions or branches request only newly needed assets. The full catalog and source ranges remain available; already-loaded scenes are refreshed together after source or asset edits.
- Focus Tree root and dependency refreshes share a serialized latest-pending queue. Ordinary document changes wait 35ms, Undo/Redo runs without an added debounce, and stale or disposed work cannot overwrite the current preview.
- Focus inlay windows, scripted GUI windows, and interface GFX fallback data are lazy and cache-backed to keep repeated preview loads cheaper than the cold path.
- Shared indexes build with background-priority file reads. One 12-slot pool serves both direct and relative reads, promotes coalesced queued preview requests, and admits waiting background work after at most three interactive admissions.
- GFX, localisation, shared-focus, and event indexes reuse disk snapshots after checking their source files and selected mod. Unsaved document changes invalidate stale snapshots. Use `HOI4 Mod Utilities: Show index build status` or `Cancel index build` to inspect or cancel active builds; a later preview request can retry a cancelled build.
- Shared-focus IDs and GFX sprite names use a lightweight Rust/WASM scanner when supported, avoiding a full script AST. Unsupported syntax and older WASM modules retain the original parser; workspace-ready hits do not wait for base-game/DLC indexes.
- GFX previews share embedded texture data across sprites and render at most eight cards concurrently. DLC ZIP files retain bounded directory metadata and read/decompress only the requested entry.
- DDS decoding, province BMP colors, and province boundaries/validation use dependency-free Rust/WASM in a lazy, bounded worker. DDS PNG encoding also runs off the extension-host thread. Bulk icon hydration can offload small DDS jobs; individual small images and unsupported formats retain the original decoder. Installed users do not need Rust.
- Vanilla/DLC localisation indexes load the selected preview language plus English, while workspace indexes retain all languages. Open-document caches use stable document/version tokens, and lint diagnostics debounce edits and reuse current-version results.
- See [actual TNO performance measurements](docs/architecture/tno-performance.md) for measured preview and editing improvements, first-paint results, and measurement limitations.
- Set `HOI4MU_PERF_TRACE=1` when launching the extension host to mirror local performance trace entries to debug logs. For comparisons, `HOI4MU_COMPUTE_BACKEND=typescript` disables the worker accelerator for that launch.
- See [Rust compute architecture and measurements](docs/architecture/rust-compute.md) for the migrated scope and performance limits.

## Settings

| Setting | Type | Description |
| --- | --- | --- |
| `hoi4ModUtilities.installPath` | `string` | Hearts of Iron IV install path. Most previews need this. |
| `hoi4ModUtilities.loadDlcContents` | `boolean` | Loads DLC image content for previews. Uses more memory. |
| `hoi4ModUtilities.modFile` | `string` | Working `.mod` file used for `replace_path` resolution. |
| `hoi4ModUtilities.previewLocalisation` | `string enum` | Preview language used by localisation-aware previews. |
| `hoi4ModUtilities.previewWheel` | `auto`, `zoom`, `scroll` | Defaults to `auto`: discrete mouse wheels zoom and smooth trackpad input pans. Select an explicit mode if device detection differs. Ctrl/Cmd + wheel always zooms. Tree and map previews also provide +/− buttons and keyboard shortcuts outside text inputs. |
| `hoi4ModUtilities.skipVanillaFiles` | `boolean` | Defaults to `true`: document, range, on-type, and workspace formatting, lint Quick Fixes, and `Source: Fix All` skip vanilla files under `hoi4ModUtilities.installPath`, including DLC folders, and vanilla-derived folders: `interface`, `gfx`, `common/names`, `common/occupation_laws`, `common/special_projects`, `common/technologies`, `common/units` (except `names_divisions` and `names_ships`), and `history/states`. Lint warnings are still shown. Turn off to format and fix them. |
| `hoi4ModUtilities.formatter.ignoreFiles` | `string[]` | Workspace-folder-relative glob patterns excluded from document, range, on-type, and workspace formatting, in addition to `hoi4ModUtilities.skipVanillaFiles`. Use forward slashes, such as `common/generated/**` or `**/legacy.txt`. |
| `hoi4ModUtilities.featureFlags` | `string[]` | Feature flags for advanced flows. Choose supported values directly in VS Code settings. GFX/localisation indexes are enabled without flags; use `!gfxIndex` or `!localisationIndex` to disable them. Use `technologyShowId` to show raw technology IDs in the technology tree preview. |

## Development

This fork targets desktop VS Code only and uses the esbuild-based build pipeline in this repository.

The build copies tracked manifest translations from `i18n/package.nls.*.json` into the generated root bundles, filling missing keys from `package.nls.json`. Runtime `l10n` bundles remain maintained directly.

Recommended environment:

- Node.js 20 LTS
- npm 10+
- Stable Rust with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- Windows for the closest match to the packaged release workflow

Common commands:

```bash
npm ci
npm run compile-ts
npm run build
npm run lint
npm run test
npm run test-ui
npm run package
npm run test:rust
npm run bench:compute
```

Role-specific TypeScript configs:

- `tsconfig.extension.json`: extension-host sources under `src`
- `tsconfig.webview.json`: browser-facing `webviewsrc` entrypoints plus shared imports
- `tsconfig.test.json`: emitted unit/integration test compile under `out`
- `tsconfig.json`: aggregate editor-facing config for the whole workspace

Watch mode:

```bash
npm run watch
```

`npm run watch` runs extension-host typecheck, webview typecheck, and esbuild bundle watching in parallel so host/webview regressions surface in the right stream.

Architecture notes:

- [Architecture Overview](docs/architecture/overview.md)

One-shot verification:

```bash
npm run verify
```

`npm run verify` runs typecheck, bundle build, lint, unit tests, VS Code integration tests, and VSIX packaging.

## Release Flow

Push a semantic version tag that matches `package.json`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions rebuilds the extension on `windows-latest`, validates the tag, runs the verification pipeline, and publishes the generated `.vsix` plus checksum to the matching GitHub Release.

## Demos

### World map preview

![World map preview demo](demo/5.gif)

### Focus tree preview

![Focus tree preview demo](demo/1.gif)

### Event tree preview

![Event tree preview demo](demo/6.gif)

### Technology tree preview

![Technology tree preview demo](demo/4.gif)

### GUI preview

![GUI preview demo](demo/7.gif)
