# 2026-04-18 Refactor Audit

## Scope

Repository-wide audit for `server.hoi4modutilities` with three goals:

1. inventory all user-facing features and their current registration points
2. compare the extension against current VS Code extension guidance
3. define a phased refactor plan that reduces risk without breaking preview-heavy workflows

This document is based on local code inspection plus current public guidance from the VS Code docs and recent comparable Paradox-modding extensions.

## Current Feature Inventory

### Manifest and entrypoints

- Extension host entrypoint: `src/extension.ts`
- Host build output: `dist/extension.js`
- Webview bundles: `static/focustree.js`, `eventtree.js`, `techtree.js`, `worldmap.js`, `gfx.js`, `guipreview.js`, `miopreview.js`
- Custom editors: `.dds`, `.tga`
- Restorable webview panels: HOI4 preview panel, world map preview panel

### User-facing features

- Generic HOI4 file preview command and editor-title button
- Focus tree preview and edit helpers
- Event tree preview
- Technology tree preview
- GUI preview
- GFX preview
- MIO preview
- World map preview
- DDS/TGA custom editors
- Localisation highlighting
- Country color provider
- Reference scanning command
- Focus GFX shine generation command
- HOI4 install path selection and read-only filesystem provider
- Mod file selection / replace-path support

### Internal architectural slices

- `src/services/*`: activation-time registration
- `src/previewdef/*`: preview detection, loading, webview lifecycle, preview content generation
- `src/util/*`: file system, localisation, config, color provider, focus helpers, telemetry, parser-adjacent utilities
- `webviewsrc/*`: browser-side preview UI entrypoints
- `scripts/build.mjs`: host/webview bundling and static asset staging

## Current Architecture Summary

### What is already in good shape

- Activation is narrower than old-school eager extensions: the manifest uses `workspaceContains`, `onWebviewPanel`, and custom-editor restoration instead of `*`.
- The top-level activation path is short: `activate()` creates one service registry, then registers telemetry, previews, editor helpers, indexes, and dev-only commands.
- Host and webview bundling are already separated in `scripts/build.mjs`.
- Preview providers are at least conceptually normalized behind descriptors and a resolver.

### Where the coupling is still high

- `PreviewManager` owns too many responsibilities at once:
  - command registration
  - context-key refresh
  - document resolution
  - panel restore
  - preview reuse
  - dependency-triggered updates
  - debounce scheduling
- Many capabilities still import configuration and VS Code globals directly from utility modules, which makes unit isolation fragile.
- The repository has a host/webview split in folders, but not yet a clean build/test split in TypeScript config and dependency boundaries.
- Feature registration is grouped by technical layer (`editor`, `indexes`, `previews`) rather than by product feature, which makes large refactors harder to stage.

## Current VS Code Guidance Check

### Guidance reviewed

- Activation events reference: current note says commands, contributed languages, views, and custom editors no longer need explicit activation entries in many cases starting with VS Code 1.74+, but `onWebviewPanel` is still relevant for restoring webview panels.
- Webview UX guidance: use webviews only when needed, activate contextually, open only for the active window, keep views themeable, and treat accessibility as first-class.
- Bundling guidance: bundle extension code, run `tsc --noEmit` separately for type checks, and keep architectural layering clean so test code does not leak into the bundle.

### Repo status against that guidance

- Good:
  - Uses contextual activation.
  - Uses esbuild plus separate type-check step.
  - Keeps webview entrypoints separate from extension-host entrypoint.
- Needs work:
  - Redundant activation entries for custom editors are still present.
  - The extension is desktop-only in practice but the package does not clearly encode a future web/non-web posture beyond `extensionKind`.
  - Webview-heavy surfaces should be audited for theme token usage and keyboard accessibility, not just functionality.
  - Test-time imports still pull VS Code configuration too early, which violates the clean layering goal called out in bundling guidance.

## Comparable Extension References

### CWTools: Paradox Language Services

- Current marketplace positioning emphasizes language services, validation, hover docs, localisation linkage, and multi-root workflows.
- The public repository structure is notably more segmented than this repo: dedicated client/source areas plus separate TS configs for extension and webview surfaces.
- Refactor takeaway: keep parsing/validation services independently testable and do not let UI-driven preview logic become the organizing center for everything.

### HOI4 Mod Kit

- Current marketplace positioning emphasizes a launcher flow, visual editor, diff-first save path, and explicit utility grouping.
- Refactor takeaway: feature-oriented surface grouping is clearer to users than command accumulation; write paths should be visibly safer than preview-only paths.

### Gazio's Paradox Extension

- Current marketplace positioning centers on one narrow feature done in a VS Code-native way: color provider integration.
- Refactor takeaway: where VS Code has a native API surface, prefer that over custom preview/UI expansion.

## Main Findings

### P1

- `PreviewManager` is the primary refactor seam. It should be split into:
  - activation/registration adapter
  - active-editor context service
  - preview session store
  - restore/open coordinator
  - document/dependency update pipeline
- Unit tests are not reliably isolated from VS Code globals. Current `npm run test:unit` fails because configuration access is executed during module import, before test doubles fully stand in.
- Existing service registration is easy to follow at startup, but the abstraction level is uneven: some "services" are true orchestration units, others are just thin registration wrappers over util modules.

### P2

- The manifest mixes modern and legacy activation patterns.
- Build structure is functional, but the repo would benefit from explicit `tsconfig` separation for:
  - extension host
  - webview/browser code
  - tests
- Feature ownership is scattered. Example: focus-tree behavior spans preview definition, preview-local runtime helpers, edit handlers, schema helpers, inlay logic, and webview update code.

### P3

- README and package metadata explain features well enough, but the internal architecture is not documented at the same granularity as the actual feature surface.
- Some commands remain dev- or maintenance-oriented without a stronger product grouping in the command surface.

## Recommended Refactor Phases

### Phase 1: Stabilize seams without product changes

- Extract a `PreviewContextService` from `PreviewManager`
- Extract a `PreviewSessionStore` from `PreviewManager`
- Replace direct config-at-import patterns with lazy access or injected accessors
- Make unit tests boot with explicit VS Code shims before any feature modules evaluate
- Remove redundant activation entries that current VS Code no longer requires

### Phase 2: Reorganize by feature boundary

- Create feature folders that own host + webview + test surfaces together where practical:
  - `features/focustree`
  - `features/eventtree`
  - `features/technology`
  - `features/worldmap`
  - `features/gfx`
  - `features/gui`
  - `features/mio`
- Leave shared parser/index infrastructure in dedicated shared modules
- Keep feature registration declarative from a single manifest-like list

### Phase 3: Modernize package/build/test ergonomics

- Split TS configs for host, webview, and tests
- Add watch scripts that mirror current VS Code bundling guidance more closely
- Revisit whether selected webview surfaces can be made more theme-token-driven and accessibility-audited
- Re-check extension packaging for unnecessary desktop-only assumptions versus intentional desktop-only policy

### Phase 4: Product-surface cleanup

- Re-group commands into clearer user flows
- Audit editor-title buttons and when-clauses for strict relevance
- Document feature ownership and high-risk modules in `docs/architecture`

## Concrete First Execution Slice

If implementation starts immediately, the lowest-risk high-value sequence is:

1. decouple configuration access from module import time
2. repair `test:unit` isolation
3. split `PreviewManager` into smaller services without changing preview behavior
4. clean manifest activation redundancy after tests cover restore/open paths

## Verification Notes

Local verification run during this audit:

- `npm run compile-ts`: passed
- `npm run test:unit`: failed

Current observed unit-test failure:

- `TypeError: vscode.workspace.getConfiguration is not a function`
- failure occurs during module import through feature/config utilities, which confirms a real testability seam in the current architecture

## Risk Notes

- The worktree already contains unrelated in-progress changes in core files such as `package.json`, `src/previewdef/previewmanager.ts`, and tests. Any implementation phase should preserve those edits and avoid broad overwrite-style refactors.
- Focus tree and world map remain the highest-risk surfaces because they combine parser logic, host-side orchestration, webview state, and restore behavior.
