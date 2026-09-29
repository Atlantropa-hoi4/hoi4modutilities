# Architecture Overview

`server.hoi4modutilities` is a desktop VS Code extension for Hearts of Iron IV modding. The repository now uses a feature-oriented ownership model on top of shared preview, parser, and indexing infrastructure.

## Entry Points

- Extension activation: `src/extension.ts`
- Feature catalog: `src/features/catalog.ts`
- Preview orchestration: `src/previewdef/previewmanager.ts`
- Preview context/session helpers:
  - `src/previewdef/previewcontextservice.ts`
  - `src/previewdef/previewsessionstore.ts`
- World map singleton preview container: `src/previewdef/worldmap/worldmapcontainer.ts`
- Custom image editors: `src/ddsviewprovider.ts`
- Host bundle/build pipeline: `scripts/build.mjs`

## Feature Ownership

Feature declarations live under `src/features/*` and answer a simple question: which preview descriptors, editor commands, indexes, or custom editors belong to one product feature?

Current feature modules:

- `focustree`
- `eventtree`
- `technology`
- `gui`
- `mio`
- `gfx`
- `worldmap`
- `images`
- `localisation`
- `references`
- `workspace`
- `countrycolors`

The feature catalog keeps preview priority stable while allowing `services/previews.ts`, `services/editor.ts`, and `services/indexes.ts` to stay as thin assembly layers.

## Runtime Layers

### Shared infrastructure

- `src/hoiformat/*`: parser and Clausewitz-format helpers
- `src/services/indexService.ts`: reusable cache/index lifecycle
- `src/util/*`: file loading, localisation, telemetry, config access, HTML helpers, image helpers, and VS Code integration utilities

### Preview host side

- `src/previewdef/*`: preview detection, base classes, dependency tracking, focus tree loader/runtime helpers, and world map handling

### Webview/browser side

- `webviewsrc/*`: browser entrypoints and rendering logic for focus tree, event tree, technology, world map, GFX, GUI, and MIO previews

### Focus tree update pipeline

The host keeps the last render cache per preview and plans each refresh against it
(`src/previewdef/focustree/renderpayloadpatch.ts`). Protocol v4 sends:

- full scenes (`focusTreeScene`) for the first render and layout changes;
- patches (`focusTreeScenePatch`) with per-tree deltas: changed focus views, focus source
  ranges, warnings or warning navigation ranges, and changed tree fields. Trees whose focus
  ids were added, removed, or reordered are replaced whole;
- asset updates (`focusTreeAssetBatch`) for hydration, with content-addressed style classes so
  patches only append rules the webview does not have.

Focus cards are not sent as per-focus HTML. The host renders one GUI card template per
background and overlay variant (`focusTemplates`, keyed by content hash) and maps each focus
to its template (`focusTemplateKeyById`); patches send only templates the webview lacks.
The webview fills the placeholders defined in `src/previewdef/focustree/cardtemplate.ts`
(id, label, file, title, checkbox, and icon class) from each focus view.

Source offsets never enter render signatures or card markup, so edits above a focus do not
re-render it. The webview entry `webviewsrc/focustree.ts` wires these modules under
`webviewsrc/focustree/`:

- `runtime.ts`, `selection.ts`: shared document, selection, and interaction state
- `scene.ts`, `scenestore.ts`, `cards.ts`: retained scene that reconciles nodes and edges by
  focus id, fills and parses card markup in batches, and materializes off-screen nodes within
  a frame budget whose node count adapts to the measured frame interval
- `visualstate.ts`: hover, selection, link, search, filter, and branch states as classes and
  body attributes styled by the shell stylesheet
- `content.ts`: layout plan and scene render for the selected tree
- `editing.ts`, `toolbar.ts`, `search.ts`, `conditions.ts`, `inlays.ts`: interactions and toolbar
- `hostsync.ts`, `messageapply.ts`, `telemetry.ts`: host protocol, delta application, and timings

## Command Surface

The command palette is now grouped by user intent:

- `1_preview`: open file and world-map previews
- `2_tools`: event-reference scanning and focus shine generation
- `3_setup`: install-path and working-mod selection
- `9_dev`: development-only commands

The editor title keeps only the high-signal actions:

- preview current previewable document
- generate focus shine for executable goals-like `.gfx` files

## High-Risk Modules

These areas deserve extra care during refactors:

- `src/previewdef/previewmanager.ts`
  - central preview open/restore/update orchestration
- `src/previewdef/focustree/*`
  - highest-complexity feature; mixes parser-derived schema, host-side runtime, local editing, and webview sync
- `src/previewdef/worldmap/*`
  - singleton preview container with heavy data loading
- `src/util/fileloader.ts`
  - mod/vanilla/DLC resolution seam used by multiple features
- `src/util/localisationIndex.ts`, `src/util/gfxindex.ts`, `src/util/sharedFocusIndex.ts`
  - lazy caches that affect cold-path and repeated preview behavior

## Recommended Refactor Discipline

- Keep feature ownership in `src/features/*`
- Keep shared parser/index/file-loading code outside feature folders
- Prefer adding new command/index/editor registrations through the feature catalog instead of hard-coding in `services/*`
- Treat focus tree and world map as regression-sensitive surfaces and verify them with targeted tests after structural changes
