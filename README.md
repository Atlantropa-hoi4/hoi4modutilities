# HOI4 Mod Utilities (Server)

This extension add tools for Heart of Iron IV modding. Some of the tools may work on other Paradox games.

This repository is the `server.hoi4modutilities` fork of the original `chaofan.hoi4modutilities` extension. The extension ID is intentionally different so it can be installed and maintained independently from the upstream release.

## Features

* World map preview
* Focus tree preview
* Event tree preview
* Technology tree preview
* Military industrial organization (MIO) preview.
* GUI preview
* `.gfx` file preview (sprites used by HOI4 are defined here)
* `.dds`, `.tga` file preview (images files used by HOI4)

For feature details and user manual, please refer to the fork wiki and repository documentation. Upstream historical docs are still useful for background, but this fork ships independently.

## Steps to start

1. Install and enable this extension in VSCode.
2. Set the Hearts of Iron IV install path. You can:
    * Open command palette using `Ctrl+Shift+P`. Use command `Select HOI4 install path` to browse the folder that installed Hearts of Iron IV.
    * Update setting `hoi4ModUtilities.installPath` (you can open settings page of VSCode using `Ctrl+,`) to the folder that installed Hearts of Iron IV.
3. Open your mod develop folder.
4. (*Optional*) Open command palette using `Ctrl+Shift+P`. Use command `Select mod file` to set working mod descriptor (the `.mod` file).
5. Use these entries:
    * Command palette (`Ctrl+Shift+P`) commands: `Preview World Map` and `Preview HOI4 file`*.
    * `Preview HOI4 file` (![Preview HOI4 file button](demo/preview-icon.png))* button on right-top tool bar of text editor.
    * Open a `.dds` or `.tga` file.

\* *`Preview HOI4 file` (![Preview HOI4 file button](demo/preview-icon.png)) button/command is invisible, except on `.gfx`, `map/default.map`, technology tree or national focus tree files.*

## Demos

### World map preview

![World map preview demo](demo/5.gif)

### Focus tree preview

![Focus tree preview demo](demo/1.gif)

### Event tree preview

![Event tree preview demo](demo/6.gif)

### Technology tree preview

![Technology tree preview demo](demo/4.gif)

### GUI Preview

![GUI preview demo](demo/7.gif)

## Extension Settings

|Setting|Type|Description|
|-------|----------|--------|
|`hoi4ModUtilities.installPath`|`string`|Hearts of Iron IV install path. Without this, most features are broken.|
|`hoi4ModUtilities.loadDlcContents`|`boolean`|Whether to load DLC images when previewing files. Enabling this will use more memory (All DLCs are around 600MB).|
|`hoi4ModUtilities.modFile`|`string`|Path to the working `.mod` file. This file is used to read replace_path. If not specified, will use first `.mod` file in first folder of the workspace.|
|`hoi4ModUtilities.enableSupplyArea`|`boolean`|If you are developing mod for HOI4(version<=1.10). Use this to check enable supply area.|
|`hoi4ModUtilities.previewLocalisation`|`enum`|Language of content in event tree preview.|
|`hoi4ModUtilities.featureFlags`|`array` of `string`|Feature flags are used to disable or enable features. Reloading is required after changing this. Please refer to this fork's GitHub documentation for details.|

## Known Issues

* GUI of focus tree can't be configured like technology tree.
* Edge lines on world map not alway fit edge of colors.
* Event tree preview will duplicate events even they are same event if they are from different option.

## Development

This extension now targets desktop VS Code only.

For local development, use Node.js 20 LTS and run:

```bash
npm ci
npm run verify
```

`npm run verify` runs the local build, lint, unit tests, VS Code integration tests, and VSIX packaging flow from the repository root.

## Release Automation

This repository now publishes release assets from GitHub Actions when you push a semantic version tag that matches `package.json`.

```bash
git tag v0.13.20
git push origin v0.13.20
```

The release workflow rebuilds the extension on `windows-latest`, validates that the tag matches the extension version, runs compile/lint/test/test-ui/package verification, and attaches the generated `.vsix` plus a SHA-256 checksum file to the GitHub Release for that tag.
