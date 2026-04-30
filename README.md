# HOI4 Mod Utilities

Desktop VS Code utilities for Hearts of Iron IV modding, maintained as the independent `server.hoi4modutilities` fork of the original `chaofan.hoi4modutilities` extension.

## What It Covers

- Focus tree preview and editing helpers
- World map preview
- Event tree preview
- Technology tree preview
- MIO preview
- GUI preview
- `.gfx` sprite preview
- `.dds` and `.tga` custom editors
- Localisation highlighting and preview text lookup
- HOI4 script, GUI, and GFX formatter support

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
- Focus Tree refreshes coalesce dependency bursts and cancel stale work early, so rapid document edits and asset updates should stay more responsive.
- Focus inlay windows, scripted GUI windows, and interface GFX fallback data are lazy and cache-backed to keep repeated preview loads cheaper than the cold path.
- Shared indexes for GFX, localisation, and shared focuses limit file-read pressure while they build in the background.
- Set `HOI4MU_PERF_TRACE=1` when launching the extension host to mirror local performance trace entries to debug logs.

## Settings

| Setting | Type | Description |
| --- | --- | --- |
| `hoi4ModUtilities.installPath` | `string` | Hearts of Iron IV install path. Most previews need this. |
| `hoi4ModUtilities.loadDlcContents` | `boolean` | Loads DLC image content for previews. Uses more memory. |
| `hoi4ModUtilities.modFile` | `string` | Working `.mod` file used for `replace_path` resolution. |
| `hoi4ModUtilities.enableSupplyArea` | `boolean` | Enables supply-area checks for older HOI4 versions. |
| `hoi4ModUtilities.previewLocalisation` | `string enum` | Preview language used by localisation-aware previews. |
| `hoi4ModUtilities.featureFlags` | `string[]` | Feature flags for advanced or experimental flows. |

## Development

This fork targets desktop VS Code only and uses the esbuild-based build pipeline in this repository.

Recommended environment:

- Node.js 20 LTS
- npm 10+
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
git tag v0.13.7
git push origin v0.13.7
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
