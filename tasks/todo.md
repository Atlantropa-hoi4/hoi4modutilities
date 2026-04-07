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
- Follow-up regression fix: removed the shell/hydration render split again because it left the expensive host-side `renderedFocus` build intact and only added extra webview work on top of the same initial load.
- Follow-up responsiveness fix: create/delete now send lightweight success acks and apply a small local preview mutation before the normal patch refresh finishes, so the focus node appears or disappears immediately in the active tree.

## Verification
- `npm run compile-ts` passed.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-focushydration.test.js out\\test\\unit\\focustree-layoutplan.test.js out\\test\\unit\\focustree-webviewupdate.test.js out\\test\\unit\\focustree-renderpayloadpatch.test.js out\\test\\unit\\focustree-conditionexprs.test.js out\\test\\unit\\focustree-inlay.test.js out\\test\\unit\\focustree-focusicongfx.test.js out\\test\\unit\\focustree-schema.test.js` passed with 24 tests.
- `npm run package` passed and produced `hoi4modutilities-0.13.22.vsix`.
- `npx mocha --exit out/test/unit/focustree-localpreview.test.js out/test/unit/focustree-layoutplan.test.js out/test/unit/focustree-webviewupdate.test.js out/test/unit/focustree-renderpayloadpatch.test.js out/test/unit/focustree-conditionexprs.test.js out/test/unit/focustree-inlay.test.js out/test/unit/focustree-focusicongfx.test.js out/test/unit/focustree-positionedit.test.js out/test/unit/focustree-schema.test.js` passed with 50 tests.

# Focus Preview Load Regression 2026-04-07

## Plan
- [x] 최근 focustree 변경 이력과 기존 성능 메모를 검토해 회귀 후보를 좁힌다
- [x] 현재 focus preview 초기 로드/문서 갱신 경로를 추적해 비용이 큰 단계를 특정한다
- [x] 정적 코드 분석 근거를 바탕으로 회귀 원인과 우선순위별 해결 계획을 문서화한다
- [x] P1 host refresh 경로에 단계별 timing 계측을 추가해 `loader/load`, `renderedFocus` 생성, patch diff, webview postMessage 비용을 분리 측정한다
- [x] P2 same-document refresh에서 전체 `renderedFocus` 재생성과 전체 tree deep diff를 제거하고, 변경된 tree/focus만 계산하는 host-side delta 경로를 구현한다
- [x] P3 webview 증분 갱신에서 전체 focus 대상 재바인딩을 없애고, 변경된 node만 checkbox/nav/drag 핸들러를 갱신하도록 줄인다
- [ ] P4 대형 focustree fixture 기준으로 초기 오픈/한 번의 편집 후 반영 시간을 재측정하고 회귀 방지용 perf 검증 항목을 남긴다

## Notes
- Primary regression: 현재 `refreshDocument()`는 webview가 이미 준비된 뒤에도 먼저 전체 `buildFocusTreeRenderPayload()`를 다시 수행합니다. 즉, loader 재실행, 모든 focus HTML 생성, 모든 inlay HTML 생성, 그리고 전체 payload 직렬화를 끝까지 수행한 다음에야 patch 전송을 시도합니다.
- Primary regression detail: 그 직후 `createFocusTreeRenderPatch()`가 이전/새 tree를 `isEqual()`로 다시 깊게 비교하고, `renderedFocus`/`renderedInlayWindows` 전체 맵도 한 번 더 diff 합니다. 결과적으로 최근 incremental path는 "기존의 전체 렌더 비용 + 추가 diff 비용" 구조가 되어 대형 트리에서 회귀를 만들었습니다.
- Secondary regression: webview 측 `getFocusTreeContentUpdateDecision()`도 선택된 tree에 대해 다시 deep compare용 incremental model을 만들어 `isEqual()`을 수행합니다. host에서 한 번 큰 비교를 한 뒤 client에서 비슷한 크기의 비교를 한 번 더 하는 셈입니다.
- Secondary regression detail: 증분 갱신이 성공해도 `applyIncrementalCurrentTreeUpdate()`는 바뀐 focus 몇 개만 반영한 뒤 `setupCheckedFocuses(Object.values(focusTree.focuses), ...)`로 전체 focus를 다시 훑으며 checkbox/handler를 재설정합니다. 큰 tree에서는 이 O(N) 재바인딩이 patch 이점을 상당 부분 상쇄합니다.
- Initial-load constraint: 첫 오픈 경로는 여전히 host에서 전체 `renderedFocus`를 만들고 bootstrap script로 `JSON.stringify()`한 뒤, webview에서 `buildContent()`가 모든 grid item HTML을 조립합니다. 따라서 첫 로드 최적화는 client-side shell 분할만으로는 부족하고, host payload 축소와 함께 진행해야 합니다.
- Minor cleanup candidate: `renderCurrentFocusHtml()`가 focus마다 `new StyleTable()`을 만들어 icon class를 계산합니다. 주원인은 아니지만, 대형 트리에서 반복 객체 생성과 조건 평가를 조금 더 키우므로 P3 정리 때 같이 정돈하는 편이 좋습니다.

## Review
- `src/previewdef/focustree/index.ts`는 refresh마다 먼저 `buildFocusTreeRenderBaseState()`로 loader/load 비용만 측정한 뒤, patch plan이 실제로 full payload를 요구할 때만 `buildFocusTreeRenderPayloadFromBaseState()`를 호출하도록 바뀌었습니다. 이 경로는 `debug('[focustree] refresh timings', ...)` 로그로 `loadMs`, `patchPlanMs`, `payloadBuildMs`, `postMessageMs`를 분리 기록합니다.
- `src/previewdef/focustree/renderpayloadpatch.ts`는 `isEqual()` 기반 deep compare 대신 tree/focus/inlay fingerprint를 계산해 patch 여부를 판단합니다. style dependency나 inlay HTML이 바뀐 경우에는 여전히 full fallback하지만, 일반적인 same-document focus text/file/warning/layout 메타데이터 변경은 전체 `renderedFocus` 재생성 없이 변경된 focus HTML만 다시 계산합니다.
- `src/previewdef/focustree/focusrender.ts`를 새로 분리해 full render와 patch render가 같은 focus HTML 템플릿 코드를 공유하도록 정리했습니다. 덕분에 host delta 경로가 `contentbuilder.ts` 전체에 묶이지 않고 unit test에서도 직접 검증 가능합니다.
- `src/previewdef/focustree/webviewupdate.ts`는 host가 보내는 `structurallyChangedTreeIds`를 그대로 사용해 current tree rebuild 여부를 결정하도록 단순화되었습니다. client-side `isEqual()` deep compare는 제거되었습니다.
- `webviewsrc/focustree.ts`는 증분 focus HTML 교체 후 전체 `rebuildRenderedFocusElementCache()`와 전체 checkbox/drag 재바인딩을 하지 않고, 변경된 focus id에 대해서만 navigator/checkbox/drag binding을 다시 적용합니다. `renderCurrentFocusHtml()`의 icon class 계산도 `new StyleTable()` 생성 없이 고정 class name으로 바뀌었습니다.
- `webviewsrc/util/common.ts`의 `subscribeNavigators()`는 이제 전체 document 대신 특정 subtree만 다시 스캔할 수 있어, 부분 DOM 교체 시 전체 navigator 재검색 비용을 줄입니다.
- 남은 범위: inlay HTML 변화나 icon/style dependency 변화는 아직 full fallback입니다. P4에서 대형 fixture로 timing 로그를 보며 이 fallback 비중이 실제 병목인지 재측정이 필요합니다.

## Verification
- `npm run compile-ts` passed.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-renderpayloadpatch.test.js out\\test\\unit\\focustree-webviewupdate.test.js` passed with 7 tests.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-localpreview.test.js out\\test\\unit\\focustree-layoutplan.test.js out\\test\\unit\\focustree-renderpayloadpatch.test.js out\\test\\unit\\focustree-webviewupdate.test.js` passed with 12 tests.
