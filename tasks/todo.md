# Focus Tree Large File Performance 2026-04-06

## Plan
- [x] Current focustree render path and large-file bottlenecks를 다시 확인하고 hot path를 특정한다
- [x] P1 host-side diff payload path를 구현해 same-structure refresh 전송량을 줄인다
- [x] P2 webview-side full rerender를 줄이고 current tree incremental update 경로를 추가한다
- [x] P3 full rebuild 경로에서도 반복되는 focus layout/connection 계산을 캐시로 줄인다
- [x] P4 initial large-tree render에서 모든 focus inner DOM을 한 번에 만들지 않고 shell-first hydration으로 첫 페인트 비용을 줄인다
- [x] 컴파일·관련 테스트·패키징으로 검증하고 결과를 정리한다

## Notes
- Current issue: large focus files still load too slowly in the Focus Tree preview.
- Root causes:
  - host-side payload generation still re-ran focus icon/image preparation for every focus, even when many focuses reused the same icon name
  - webview-side `setupCheckedFocuses()` scanned the full `conditionExprs` array for every rendered focus, creating avoidable `focus count x condition count` work on large trees
  - same-structure refreshes still pushed the full `focusTrees`, `renderedFocus`, and `renderedInlayWindows` payloads across the host/webview boundary
  - even after P1, the webview still rebuilt the selected tree with `buildContent()` for every patch, including updates that only touched another tree or only changed current-tree focus HTML metadata
  - when a full rebuild still happens, `buildContent()` recomputes allow-branch reachability, relative positions, and all prerequisite/exclusive connection models from scratch for every focus even when the tree structure and selected conditions are unchanged
  - even after P3, the initial first-open render of a huge tree still injected every full focus card DOM immediately, so the browser paid the markup/layout cost for the entire tree before the user could interact with the visible area

## Review
- `src/previewdef/focustree/contentbuilder.ts` now prepares icon render styles once per unique icon name before building `renderedFocus`, instead of re-fetching icon metadata for every focus node. The per-focus HTML render path is now synchronous string assembly over already-prepared styles.
- `webviewsrc/focustree.ts` now precomputes the set of `has_completed_focus` ids once per render via `src/previewdef/focustree/conditionexprs.ts`, so checkbox setup no longer performs a full `conditionExprs.some(...)` scan for every focus.
- Added focused regression coverage for the new completed-focus extraction helper so the large-tree checkbox optimization stays tied to the intended root-scope expressions only.
- `src/previewdef/focustree/index.ts` now keeps the last render snapshot and derives an incremental patch for same-structure `focusTreeContentUpdated` messages instead of always re-sending the full maps.
- `src/previewdef/focustree/renderpayloadpatch.ts` computes pure tree/html diffs, and `webviewsrc/focustree.ts` now merges those patches back into the existing client state before rebuilding the visible tree.
- `src/previewdef/focustree/webviewupdate.ts` now classifies incoming patch messages into three buckets: no-op for unrelated-tree updates, incremental current-tree updates when the grid render model is unchanged, and full rebuild fallback when the focus layout/branch graph actually changed.
- `webviewsrc/focustree.ts` now updates only the affected current-tree focus nodes and inlay window content when safe, while still refreshing selector/warnings state and falling back to `buildContent()` when the grid structure changes.
- `webviewsrc/util/common.ts` now makes `subscribeNavigators()` idempotent so partial DOM replacement can safely rebind updated navigator nodes without stacking duplicate click listeners.
- Scope note: P2 reduces same-document refresh cost further by avoiding full webview rerenders when the current tree grid stays stable. The initial first-open render of a huge tree still remains for a later phase.
- `src/previewdef/focustree/layoutplan.ts` now caches the expensive `allow_branch` reachability walk, relative-position resolution, and prerequisite/exclusive connection assembly per `FocusTree + condition set + visibility mode`, so rebuilds with the same tree/conditions can reuse the same grid model instead of recalculating every focus.
- `webviewsrc/focustree.ts` now consumes that cached layout plan during `buildContent()` and explicitly invalidates it when local focus position or relation edits mutate the in-memory tree, preventing stale positions while still avoiding repeated full-tree recomputation on ordinary rebuilds.
- Added regression coverage for layout-plan cache hits, invalidation after tree mutation, and the `useConditionInFocus` visibility split so future performance changes do not silently alter which focuses are rendered.
- Scope note: P3 reduces the compute cost of rebuilds that still need to render the selected tree. It does not yet virtualize the initial huge DOM build itself.
- `webviewsrc/focustree.ts` now renders lightweight focus shells first and hydrates full focus markup only for selected focuses or nodes near the current viewport, which cuts the initial DOM payload and first layout work on very large trees without breaking existing drag, navigation, or incremental-update paths.
- `src/previewdef/focustree/focushydration.ts` centralizes the hydration decision as a pure helper so the webview no longer accidentally force-hydrates every shell during the initial build, and future tuning of viewport margin behavior stays testable.
- Added regression coverage for hydration rules so off-screen unselected focuses stay as shells on first render, while selected focuses still hydrate immediately even outside the viewport.

## Verification
- `npm run compile-ts` passed.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-focushydration.test.js out\\test\\unit\\focustree-layoutplan.test.js out\\test\\unit\\focustree-webviewupdate.test.js out\\test\\unit\\focustree-renderpayloadpatch.test.js out\\test\\unit\\focustree-conditionexprs.test.js out\\test\\unit\\focustree-inlay.test.js out\\test\\unit\\focustree-focusicongfx.test.js out\\test\\unit\\focustree-schema.test.js` passed with 24 tests.
- `npm run package` passed and produced `hoi4modutilities-0.13.22.vsix`.
