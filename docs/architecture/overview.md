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

Direct and relative file reads share `src/util/fileReadScheduler.ts`: at most twelve
active reads, FIFO within `interactive`/`background`, queued single-flight promotion,
and a background admission after at most three interactive admissions when both
queues are waiting. Resolution precedence and open-document reads remain in
`fileloader.ts`; background indexes use the same scheduler, not a second limiter.
`fileloader.read` separates `waitMs`, `resolveMs`, `contentMs` and `activeMs`.

### Index publication and localisation commits

`IndexService` publishes a source/generation-validated snapshot and resolves readiness
before scheduling best-effort persistence. Detached saves remain cancellable and tracked;
the per-URI save lane retires a stale rename before a newer snapshot can publish.
`src/services/indexSerialization.ts` owns a separate lazy
`dist/index-serialization-worker.js`: one active job, two queued jobs, a 128 MiB
estimated clone budget, and a 64 MiB cache limit. JSON, UTF-8 and checksums run in
the worker; admission traversal and structured clone still cost host CPU and memory.
`indexes-v2/*.cache` contains a fixed header and one JSON payload, not escaped nested
JSON. Older snapshots miss and rebuild. Decoded data stays `unknown` until each
index target's `validateCacheSnapshot` accepts its domain shape.

Workspace localisation changes invalidate their per-file revision immediately.
The existing 1000ms typing debounce remains. `localisationIndexEvents.ts` emits
affected URIs and a revision only after an incremental or full workspace snapshot
commits. `PreviewManager` uses the existing dependency scheduler for a second refresh,
so a preview built before the localisation commit is superseded rather than left stale.

### Preview host side

- `src/previewdef/*`: preview detection, base classes, dependency tracking, focus tree loader/runtime helpers, and world map handling

### Rust compute worker

- `rust/hoi4-compute/`: dependency-free DDS pixel decoding, province BMP colors/boundaries/validation, and lightweight shared-focus/GFX script index extraction, compiled to portable WebAssembly
- `src/util/compute/*`: trusted byte-buffer ABI, lazy bounded worker service, cancellation, lifecycle, and TypeScript fallback
- The script scanner extracts shared/joint focus IDs and sprite names without building an AST. Unsupported files use the original parser. VS Code APIs, source editing, file precedence, parser/schema semantics, index lifecycle, and browser rendering remain TypeScript.
- Build outputs `dist/compute-worker.js` and `dist/hoi4_compute.wasm` ship in the universal VSIX. See [Rust compute details](rust-compute.md).

### Webview/browser side

- `webviewsrc/*`: browser entrypoints and rendering logic for focus tree, event tree, technology, world map, GFX, GUI, and MIO previews

### Focus tree update pipeline

The host keeps the last render cache per preview and plans each refresh against it
(`src/previewdef/focustree/renderpayloadpatch.ts`). Protocol v5 sends:

- full scenes (`focusTreeScene`) for the first render and layout changes;
- patches (`focusTreeScenePatch`) with per-tree deltas: changed focus views, focus source
  ranges, warnings or warning navigation ranges, and changed tree fields. Trees whose focus
  ids were added, removed, or reordered are replaced whole;
- asset demand (`focusTreeAssetRequest`) and chunk replies (`focusTreeSceneAssets`) for
  on-screen and nearby hydration, carrying tree/request/document/snapshot identities,
  materialized focus IDs and versioned style updates;
- style synchronization (`focusTreeStyleSync`, including style asset batches) with
  `{ kind, baseId, version, baseVersion?, css }`; the browser requests `styleResync`
  when it cannot apply a delta to its current base.

The structural catalog and source graph remain complete. The first asset build prepares
on-screen focuses; the browser then requests visible content before nearby content in
32-focus chunks, with one latest pending demand. Scroll, zoom, condition and branch
changes recompute demand. Already materialized focuses are retained; source/asset
invalidation refreshes the loaded scope rather than leaving cached revisits stale.
The loader retains one scoped asset base state rather than a source graph copy per
visited tree, and the dependency manifest covers every loaded scene.

The host `FocusTreeStyleLedger` keeps the latest keyed rules across all cached scenes
and preserves raw CSS. First delivery, a recreated webview, raw-style changes, or
ledger compaction sends a full base; ordinary updates send only changed/new rules.
The receiver checks base/version identity before appending and clears superseded
CSSOM rule bodies. Historical text may remain until a full replacement. Compaction
uses dead-rule thresholds (2 Mi UTF-16 characters and at least half of live-rule
characters); this is not a bound on total DOM, cached scenes or process memory.

Readiness checks actual displayed icon CSS (`loaded`, `placeholder`, `unavailable`).
`sceneRendered` follows the scene paint; `sceneAssetsReady` identifies each selected-tree
epoch, including revisits, only after real on-screen assets are available. An empty
transient canvas or a failed gray fallback is not asset readiness. Loading status uses
`role=status`, `aria-live=polite`, delayed display and reduced-motion styling.

Focus root/dependency changes share a serialized refresh key: one running update and
one latest pending update, preserving the union of invalidated dependencies. Document
changes wait 35ms, Undo/Redo 0ms and disk dependency events 150ms. Cancellation checks
scheduled callbacks and render/session generations before committing; other preview
families keep their existing scheduling defaults.

Host-side render and loader progress checkpoints use `setImmediate` rather than
zero-delay timers. They still yield to host events and check cancellation before
committing, without paying Windows timer granularity for each batch.

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
- `assetdemand.ts`, `assetloading.ts`: viewport-priority demand, materialization requests, real-icon readiness, and accessible loading state
- `hostsync.ts`, `messageapply.ts`, `telemetry.ts`: host protocol, delta application, and timings
- `searchnavigation.ts`: full-catalog match traversal, current match restoration,
  shown-condition/branch filtering and mount-before-scroll navigation
- `stylesheet.ts`, `warningspanel.ts`, `../util/combobox.ts`: style base validation,
  warning focus/inert transitions and shared keyboard listbox behavior

### Images and World Map generations

`Sprite.getFrame(index)` replaces eager frame arrays. Only valid requested frames are
cropped and encoded; a single-frame sprite returns the original image. Encoded frames
remain cached, while decoded atlas scratch is released after the synchronous batch.
A later uncached frame can require another atlas decode.

The map browser stages generation-tagged collection diffs until the matching completion
and publishes once. Stale, late and duplicate completion messages do not publish;
generationless editor updates still apply immediately to a cloned committed map.
`WorldMapLoadQueue` aborts superseded generations. Shared loader flights own their
compute signal and abort only after every consumer cancels; one cancelled preview
cannot interrupt another consumer. `src/util/cooperative.ts` yields TypeScript map
fallback/zone/region loops through `setImmediate` with a work/time budget, preserving
province geometry, seam handling and warning navigation.

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
