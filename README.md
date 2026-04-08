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
- The focus tree preview no longer performs a redundant pre-ready full load before the webview handshake, which shortens the first-open path on large trees.
- Shared indexes for GFX, localisation, and shared focuses are lazy and cache-backed to keep repeated preview loads cheaper than the cold path.

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
npm run build
npm run lint
npm run test
npm run test-ui
npm run package
```

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
