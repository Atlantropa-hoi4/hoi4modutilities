# Structural performance improvements

Measured on Windows with Node.js v24.14.0 on 2026-09-22 against commit
`c2afd9eb3c2c0b850d772dc0631a0d503208d19d`. The working tree contains the changes below.
No dependency versions, public commands, configuration keys, or extension identity changed.
The later focus tree preview refactor is described in
[2026-09-29: Focus tree preview refactor](#2026-09-29-focus-tree-preview-refactor).

## Focus trees

- Branch membership propagation visits dependents of changed prerequisites. A work queue
  preserves file-order propagation and the order of branch names, including cyclic graphs.
- Relative coordinates use iterative traversal and cached anchors. Very deep chains no
  longer consume the JavaScript call stack; missing and cyclic anchors retain their prior
  zero-origin behavior. Relative-position validation uses disjoint sets and walks only
  detected cycles, preserving warning paths and navigation ranges.
- Scene geometry retains an adjacency index. Measuring one focus only revisits its
  incident edges. Identical bounds and identical paths do not request SVG updates.
- SVG elements are indexed by edge ID. Hover checks use endpoint IDs instead of repeatedly
  searching CSS classes for every related focus.
- Measurements requested during mounting, hydration, or visibility changes are deduplicated
  and processed in batches of at most 120 focuses per animation frame. Scene resets cancel
  obsolete work. Dragging suspends measurements of the temporary transform; both committing
  and cancelling a drag request a fresh measurement after restoring the DOM transform.
- Position-only edits retain edge objects and measured icon bounds, translate the moved
  nodes, and reroute affected edges. The exclusive-link icon anchors remain independent
  of label width.

## Shared paths and affected features

| Shared change | Directly affected paths |
| --- | --- |
| Map LRU with incremental byte accounting | Image/sprite/GFX and file-resolution caches used by focus, technology, event, decision, idea, character, MIO, GUI/GFX previews and map resource icons |
| Coalesced asynchronous cache validation | Simultaneous requests for an expired cache entry share validation and replacement; removal, clearing, disposal, failure retries, and stale completion checks are retained |
| Ordered Set for file-list merging | Mod/dependency/DLC/base-game resolution, map folder loaders, localisation/GFX/shared-focus/event indexes, index snapshot validation and reference scanning |
| Lazy parser diagnostic line index | Script parsing in previews, indexes, formatting, linting, and workspace logging; successful parsing avoids full-text splitting and three line-sized arrays |
| Batched viewport persistence | Shared zoom and scroll handlers; reads see current coordinates immediately, selection/edit state still persists synchronously, and hidden/page-exit state flushes immediately |
| One graph measurement phase | Event and decision graph labels reuse width and height measured before node positioning and SVG writes |

The dedicated DDS/TGA decoding and flag-resizing algorithms were not changed. Their
standalone processing speed was not measured; improvements elsewhere must not be presented
as acceleration of those operations. Existing cancellation, bounded image work, map frame
batching, and preview lifecycle controls remain in place.

## Reproducible measurements

From the repository root, after installing the locked development dependencies:

```powershell
node scripts/benchmark-performance.mjs --baseline=c2afd9e
```

The script emits JSON, including entries collected through `src/util/perf.ts`. Set
`$env:HOI4MU_PERF_TRACE = '1'` when running in an extension-host environment to mirror
performance entries to the existing debug trace (the benchmark sends those logs to stderr
so stdout remains valid JSON). The measurements below used that trace flag. The baseline argument must precede the
branch work-queue change. The script compares isolated source routines, warms each routine,
alternates baseline/current runs, and reports medians; fixture creation and bundling are
excluded. Runtime, allocator, JIT, and other system activity affect absolute times.

| Isolated workload | Samples | Before | After |
| --- | ---: | ---: | ---: |
| 10,000 focus nodes / 9,999 edges, 2,000 local geometry updates | 5 | 246.78 ms | 5.25 ms |
| Branch propagation through a reverse-ordered 1,000-node chain | 5 | 486.45 ms | 0.52 ms |
| 12,000 cache insertions, 512-entry / 4,096-byte limit, one hit per eight insertions | 3 | 521.11 ms | 13.73 ms |
| Deduplicate 24,000 paths with 8,000 unique values, without filesystem I/O | 3 | 949.80 ms | 0.80 ms |
| Parse a valid generated script with 5,000 focus blocks / 30,000 lines | 9 | 31.40 ms | 28.47 ms |

These are CPU microbenchmarks, **not complete preview startup times or guarantees about
every mod**. Additional deterministic checks show:

- One local geometry update in a 10,000-node chain reads source IDs 10,001 times before
  and twice after the change. A regression test rejects reads of unrelated edges.
- A burst of 32 requests after cache expiration performs 32 replacement factories before
  and one after the change; the benchmark also reports the initial cold load separately.
- A viewport harness with 120 zoom/scroll pairs reduces state writes from 240 to one frame
  flush, while checking current scale reads, immediate edit-state writes, and hide/exit flushes.
- A graph harness with 401 cards and 400 labels reduces geometry reads from 1,201 to 801
  and verifies all reads precede layout writes.

## Changed files

- Shared host: `src/util/cache.ts`, `src/util/fileloader.ts`, `src/hoiformat/hoiparser.ts`.
- Focus host: `src/previewdef/focustree/branchmembership.ts`, `relativepositioncycles.ts`,
  `positioning.ts`, `focustreeschemahelpers.ts`, `scenegeometry.ts`.
- Focus browser: `webviewsrc/focustree.ts`, `webviewsrc/focustree/measurementbatcher.ts`.
- Shared browser: `webviewsrc/util/common.ts`, `viewportstate.ts`, `framescheduler.ts`,
  `graphview.ts`; `webviewsrc/worldmap/framescheduler.ts` re-exports the common scheduler.
- Measurement: `scripts/benchmark-performance.mjs` and this document.
- Tests: `test/unit/cache-metrics.test.ts`, `fileloader.test.ts`, `parser.test.ts`,
  `focustree-scenegeometry.test.ts`, `focustree-schema.test.ts`,
  `focustree-branchmembership.test.ts`, `focustree-positioning.test.ts`,
  `focustree-relativepositioncycles.test.ts`, `focustree-measurementbatcher.test.ts`,
  `webview-graphview.test.ts`, `webview-viewportstate.test.ts`.

## Verification

The current-run `npm run verify` completed successfully: extension and webview typechecks,
production bundles, ESLint, **854 unit tests**, **21 desktop integration tests** on VS Code
1.138.0, and local VSIX packaging. The package is `hoi4modutilities-1.0.0.vsix` (39 files,
approximately 1.15 MB). `node --check scripts/benchmark-performance.mjs` and
`git diff --check` also passed. No fixture modifications remained after the tests.

The focused review found a drag-transform measurement issue introduced by retained
geometry; the suspend/resume behavior described above fixes it, with regression tests
included in the full run. No commit, push, or release publication is part of this work.
Real-game installation performance, long-running memory use, and Node.js 20 execution
were not benchmarked in this run.

## 2026-09-29: Focus tree preview refactor

Measured on Windows with Node.js v24.14.0 against commit
`f80bc6cb5a935a7351e89830494cbdf5135e78fd` (a Git worktree of that commit served as the
baseline). No dependency versions, public commands, configuration keys, or extension
identity changed. The host/webview protocol constant moved from 3 to 4; host and webview
ship in the same bundle, so no mixed versions are expected.

### Design

- **Stable render signatures.** Source offsets (`start`, `end`, layout edit keys) are kept
  out of card markup, render signatures, and view signatures. Typing above a focus changes
  only its source ranges, which are sent separately.
- **Per-tree deltas.** `focusTreeScenePatch` and `focusTreeAssetBatch` carry
  `focusTreePatches`: changed focus views, source ranges, tree fields, and either full
  warnings or only warning navigation ranges. Trees whose focus ids are added, removed, or
  reordered are replaced whole. Patches name their `baseSnapshotVersion`; a webview that
  diverged requests the scene again instead of applying the delta.
- **Card templates.** The host renders the GUI card once per background and overlay
  variant and sends content-hashed templates plus a focus-to-template map. The webview
  fills id, label, file, title, checkbox, and icon placeholders
  (`src/previewdef/focustree/cardtemplate.ts`). Patches send only unknown templates.
- **Content-addressed styles.** Focus tree one-time style classes are named by content
  hash, and style patches append only rules the webview does not have. The stylesheet no
  longer grows with each edit.
- **Retained scene.** `webviewsrc/focustree/scene.ts` reconciles nodes and edges by focus
  id, parses card markup in batches through one `<template>`, keeps measured visuals for
  unchanged cards, and mounts the 120 nodes nearest the viewport before the first frame.
  The rest are materialized in 6 ms frame slices whose node count halves when frames
  arrive later than 48 ms apart and grows by 25% when they arrive within 24 ms.
- **Class-driven visual state.** Hover, selection, pending links, search, filters, and
  hidden branches are body attributes and classes styled by the shell stylesheet instead of
  per-element inline styles. Hover clearing is deferred by one animation frame so moving
  between cards does not restyle the whole tree twice.
- **Webview modules.** The former `webviewsrc/focustree.ts` monolith is split into the
  modules listed in the [overview](overview.md#focus-tree-update-pipeline).
- **Host pipeline.** Document edits invalidate only the structure stage. Icon GFX
  resolution is cached by sprite names and explicit GFX dependencies and cleared on asset,
  presentation, or layout invalidation. Render metadata and view signatures are computed in
  one pass.
- **Tokenizer.** `src/hoiformat/hoiparser.ts` scans character codes instead of matching an
  alternation regular expression. It keeps the regular expression's alternation order and
  backtracking results, including escaped quotes, unit numbers, and the `\s` whitespace set;
  unit tests compare it against the previous tokenizer on fixtures and random inputs.
- **Conditions.** Condition extraction deduplicates by a string key instead of pairwise
  deep equality.

### Measurements

Webview numbers come from a session-local harness that is not part of the repository. It
generated host messages with the real session code (sprites, images, and localisation
stubbed), replayed them into each side's production `static/focustree.js` in headless
Chrome at 1600 × 1000, and served images as local placeholders. VS Code itself was not
involved. Every value is the median of five runs; synthetic ranges span two back-to-back
before/after pairs. Inputs: `FOCUS_EXAMPLE/GXC focus (Liangguang).txt` (553 focuses), a
TFR Korea national focus file (multiple trees, 626 focuses), and a generated 1,200-focus
tree in which every card is mounted.

| Synthetic 1,200-focus tree | Before | After |
| --- | ---: | ---: |
| Initial render, first paint | 52–59 ms | 42–46 ms |
| Initial render, all nodes mounted | 477–506 ms | 131–159 ms |
| Asset hydration, painted | 267–302 ms | 42–52 ms |
| Comment edit above focuses, applied | 583–599 ms | 17 ms |
| Position edit, applied | 643–719 ms | 20–23 ms |
| Long tasks during either edit | 53–73 ms | 0 ms |
| Hover, median | 39–40 ms | 0.6 ms |
| Edit mode toggle, median | 19.5–19.8 ms | 10.9–13.6 ms |
| Hydration messages | 3,136 KB | 65 KB |
| Edit patch message | 3,123 KB | 34–35 KB |
| Stylesheet | 26,017 rules / 2,482 KB | 813 rules / 14 KB |

| Real focus files | GXC before | GXC after | TFR before | TFR after |
| --- | ---: | ---: | ---: | ---: |
| Initial render, painted | 38 ms | 36 ms | 31 ms | 28 ms |
| Asset hydration, painted | 35 ms | 20 ms | 28 ms | 14 ms |
| Comment edit, painted | 24 ms | 5 ms | 22 ms | 6 ms |
| Position edit, painted | 25 ms | 4 ms | 25 ms | 4 ms |
| Hover, median | 1.6 ms | 0.2 ms | 0.5 ms | 0.1 ms |
| Initial scene message | 542 KB | 499 KB | 699 KB | 651 KB |
| Hydration messages | 1,951 KB | 243 KB | 2,251 KB | 262 KB |
| Edit patch message | 1,756 KB | 28 KB | 2,035 KB | 39 KB |
| Tree switch scene message | — | — | 1,434 KB | 104 KB |
| Stylesheet rules | 12,822 | 1,205 | 14,414 | 1,264 |

The production `static/focustree.js` bundle shrank from 244,595 to 201,660 bytes.

Host-side measurements with the same inputs and three alternating runs: planning the
update for a comment or position edit fell from 20–53 ms to 5–13 ms, and the edit no longer
re-renders any focus card (553–1,200 cards before). Parsing the GXC file fell from
17.7–18.2 ms to 5.2–5.6 ms and a generated 5,000-focus script from 22.2–22.8 ms to
6.2–6.4 ms (medians of 15 alternating runs against `f80bc6c`, two invocations, identical
AST for both inputs). `node scripts/benchmark-performance.mjs --baseline=c2afd9e` reports
the parser at 27.99 → 6.18 ms; that baseline predates both the lazy diagnostic line index
and the scanner.

### Verification scope

`npm run verify` passed: extension and webview typechecks, the production build, ESLint,
877 unit tests, 21 desktop integration tests on VS Code 1.139.1, and local VSIX packaging
(40 files, 1.15 MB). No fixture modifications remained afterwards.

Functional parity was compared between the baseline and current bundles in the same
harness: navigation clicks, hover dimming, edit mode, drag edits, link edits, marquee
selection, search, completion checkboxes, and normalized card markup matched on all three
inputs, and tree switching matched on TFR. Two intended differences remain: an editable card keeps its
edit-mode outline after a rejected link edit, and all synthetic cards stay mounted after an
edit instead of being rebuilt around the viewport. Real-game installations, VS Code's own
webview host, long-running memory use, and Node.js 20 were not benchmarked.
