# Structural performance improvements

Measured on Windows with Node.js v24.14.0 on 2026-09-22 against commit
`c2afd9eb3c2c0b850d772dc0631a0d503208d19d`. The working tree contains the changes below.
No dependency versions, public commands, configuration keys, or extension identity changed.

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
