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
- 추가 후속 수정: `src/previewdef/focustree/index.ts`와 `src/previewdef/focustree/contentbuilder.ts`는 이제 preview 첫 open에서 full payload를 기다리지 않고 즉시 shell HTML을 띄운 뒤, webview `focusTreeWebviewReady` 이후 실제 payload를 메시지로 채웁니다. 따라서 사용자는 더 이상 첫 render 동안 `Loading...`에 묶이지 않고, 초기 bootstrap 지연이 host-side payload 생성 시간과 분리됩니다.
- 작은 파일 회귀 보정: shell-first 초기 open 경로가 작은 focustree에도 같은 고정 bootstrap 비용을 추가하고 있었기 때문에, 초기 로드는 하이브리드로 조정했습니다. 이제 `src/previewdef/focustree/index.ts`는 문서 텍스트가 작은 경우 inline full render를 바로 사용하고, 충분히 큰 경우에만 shell hydration을 사용합니다.
- 추가 후속 수정: focustree toolbar는 selector/warnings DOM을 항상 가진 정적 shell로 바뀌었습니다. `webviewsrc/focustree.ts`는 tree 개수와 warning 유무에 따라 해당 컨트롤의 표시만 토글하므로, 이후 full payload 갱신도 HTML 전체 재로드 없이 처리됩니다.
- 남은 범위: inlay HTML 변화나 icon/style dependency 변화는 아직 full fallback입니다. P4에서 대형 fixture로 timing 로그를 보며 이 fallback 비중이 실제 병목인지 재측정이 필요합니다.

## Verification
- `npm run compile-ts` passed.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-renderpayloadpatch.test.js out\\test\\unit\\focustree-webviewupdate.test.js` passed with 7 tests.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-localpreview.test.js out\\test\\unit\\focustree-layoutplan.test.js out\\test\\unit\\focustree-renderpayloadpatch.test.js out\\test\\unit\\focustree-webviewupdate.test.js` passed with 12 tests.

# FocusTree Preview Refactor 2026-04-08

## Plan
- [x] host/webview 간 초기 로드와 갱신이 공유할 unified render session / update contract를 도입한다
- [x] 텍스트 길이 heuristic과 shell/full 이원 초기 로드를 제거하고 항상 같은 bootstrap + snapshot update 경로를 사용한다
- [x] slot 단위 변경 집합(`treeBody`, `selector`, `warnings`, `inlays`, `styleDeps`)으로 host patch 계산을 단순화한다
- [x] webview가 changed slots와 changed focus ids만 적용하도록 갱신 로직과 rebind 범위를 정리한다
- [x] focustree patch/update 테스트를 새 계약 기준으로 갱신하고 compile/test로 회귀를 검증한다

## Notes
- Target: 최근 누적된 `shell-first`, `small-doc inline`, `mode=full|patch`, host/client 이중 diff를 하나의 세션 모델로 정리한다.
- Constraint: 외부 preview 동작과 편집 기능은 유지하면서 내부 render/update 타입과 흐름만 단순화한다.

## Review
- `src/previewdef/focustree/index.ts`는 이제 preview 첫 open과 이후 refresh 모두 정적 shell HTML 뒤에 동일한 snapshot update 메시지를 적용하는 구조로 통일되었습니다. 텍스트 길이 기반 inline/full 분기는 제거됐고, host는 `lastRenderCache`만 유지합니다.
- `src/previewdef/focustree/renderpayloadpatch.ts`는 `FocusTreeRenderCache`와 `snapshotVersion` 기반 갱신 모델로 재구성됐습니다. webview로 내려가는 메시지는 더 이상 `mode=full|patch`에 의존하지 않고 `changedSlots`, `changedTreeIds`, `changedFocusIds`를 명시적으로 전달합니다.
- `src/previewdef/focustree/webviewupdate.ts`는 새 slot 계약을 기준으로 selected tree rebuild 여부를 판단합니다. layout 변경만 전체 rebuild를 강제하고, 경고/selector/tree patch는 현재 선택 tree에 필요한 범위만 갱신합니다.
- `webviewsrc/focustree.ts`는 snapshot version을 추적하고, tree id 기준으로 선택 상태를 유지하며, slot별로 `focusTrees`, `renderedFocus`, `renderedInlayWindows`, toolbar 상태를 적용합니다. 또한 host와 대응되는 `[focustree] webview timings` 로그로 `apply/rebuild/rebind` 비용을 분리합니다.
- 회귀 방지 관점에서 `test/unit/focustree-renderpayloadpatch.test.ts`와 `test/unit/focustree-webviewupdate.test.ts`를 새 계약 기준으로 갱신했습니다.
- 안전한 범위 유지: inlay HTML 변경은 이번 라운드에서도 full fallback으로 남겨 unit-testable patcher가 `vscode` 런타임에 묶이지 않도록 했습니다. 다음 성능 라운드에서 이 경로를 별도 경량 renderer로 떼는 것이 자연스러운 후속 작업입니다.

## Verification
- `npm run compile-ts` passed.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-renderpayloadpatch.test.js out\\test\\unit\\focustree-webviewupdate.test.js out\\test\\unit\\focustree-localpreview.test.js out\\test\\unit\\focustree-layoutplan.test.js` passed with 12 tests.
# Extension Modernization 2026-04-08

## Plan
- [x] 현재 activation / bootstrap / build / test / i18n / webview 경로를 현대화 배치 기준으로 재구성한다
- [x] `package.json`과 빌드 스크립트를 esbuild 중심 구조, clean test harness, 최신 activation/l10n 설정으로 교체한다
- [x] extension bootstrap과 preview/index 서비스 구성을 분리해 activate 경로와 preview update orchestration을 단순화한다
- [x] runtime i18n과 webview shell/message 유틸을 표준화하고 불필요한 런타임 i18n 번들 의존을 제거한다
- [x] lint/test/패키징 기준선을 복구하고 결과 및 남은 리스크를 review 섹션에 정리한다

## Review
- `package.json`은 이제 `extensionKind: ["workspace"]`, `l10n: "./l10n"`를 선언하고 `onStartupFinished` / `onLanguage:*` / `onCommand:*` activation을 제거한 contextual activation 구조로 정리되었다.
- `scripts/build.mjs`와 `scripts/clean.mjs`, `tsconfig.test.json`을 추가해 webpack 기반 build를 esbuild 기반 build로 교체했고, `compile-ts`는 typecheck 전용, `compile-tests`는 clean 후 test output 전용으로 분리했다.
- 런타임 localization은 `src/services/localizer.ts`를 중심으로 `vscode.l10n` 기반으로 옮겼고, 빌드 단계에서 `i18n/*.ts`로부터 `l10n/bundle.l10n*.json`을 생성해 extension host와 webview가 같은 번들을 쓰도록 통일했다.
- `src/extension.ts`는 composition root로 축소했고, commands/editor/indexes/previews/telemetry 등록을 `src/services/` 아래 모듈로 분리했다.
- `src/previewdef/previewmanager.ts`는 descriptor 기반 provider registry, typed update scheduler, typed dependency subscription으로 재구성되었고 preview별 panel options를 선언적으로 받는다.
- focustree는 `retainContextWhenHidden`을 유지하고, 다른 일반 preview는 blanket context retention 없이 기본 panel 옵션을 사용하도록 정리했다.
- GFX/localisation/shared focus index는 `src/services/indexService.ts`를 통해 lazy ensure/invalidate 패턴을 공유하게 되었고, activation 직후 전역 prewarm은 제거했다.
- webview shell은 `src/util/html.ts`에서 공통 CSP, `lang`, body metadata를 일관되게 적용하며, shared `common.js` 전제 없이 entry별 self-contained bundle을 사용한다.
- stale `out/` 산출물 때문에 unit test가 깨지던 문제는 `compile-tests` clean 경로로 복구했고, integration smoke는 world map tab 감지를 더 안정적인 조건으로 바꿨다.

## Verification
- `npm run compile-ts`
- `npm run build`
- `npm run lint`
- `npm run test:unit`
- `npm test`
- `npm run test-ui`
- `npm run package`

# FocusTree Load Bottleneck + Release Refresh 2026-04-08

## Plan
- [x] focustree 초기 로드 경로를 다시 추적해 실제 병목과 중복 작업이 있는지 확인한다
- [x] 첫 로딩 체감에 직접 영향을 주는 focustree 병목을 최소 수정으로 제거한다
- [x] README를 현재 빌드/테스트/배포 흐름과 성능 특성에 맞게 갱신한다
- [x] 확장 버전을 새 릴리스 번호로 올리고 changelog/package metadata를 함께 맞춘다
- [x] 빌드와 관련 테스트로 수정 사항을 검증하고 결과를 review에 남긴다

## Review
- `src/previewdef/focustree/index.ts`는 이제 webview가 아직 `focusTreeWebviewReady`를 보내기 전에는 무거운 `buildFocusTreeRenderBaseState()` 경로를 타지 않고, shell HTML만 유지한 채 준비 완료 후 한 번만 실제 snapshot load를 수행한다.
- 이번 병목은 loader 자체보다 먼저, preview 초기화 중 `refreshDocument()`가 pre-ready 상태에서도 전체 focustree load를 수행한 뒤 결과를 버리고 shell을 다시 렌더링하는 중복 경로에 있었다. 첫 오픈에서 가장 비싼 작업이 두 번 실행되던 셈이라 체감 지연이 컸다.
- `README.md`는 현재 repo 상태에 맞춰 desktop-only 범위, contextual activation, lazy index/cache, focustree 초기 로드 개선, esbuild 기반 개발 흐름, `npm run verify`, 그리고 현재 release tagging 절차를 반영하도록 전면 정리했다.
- 버전은 `1.0.0`으로 새 릴리스 라인을 열었고, `package.json`, `package-lock.json`, `CHANGELOG.md`를 함께 맞춰 패키지와 문서가 같은 버전을 가리키도록 정리했다.
- 패키징 중 한 번 발생한 `vsce` secret-scan `ENOENT`는 산출물 경로 오류가 아니라 `test-ui`와 `package`를 병렬로 돌리면서 둘 다 `dist/static`을 다시 빌드한 레이스였다. 패키징을 단독으로 재실행해 정상 VSIX를 만들었다.

## Verification
- `npm run compile-ts` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm run test` passed.
- `npm run test-ui` passed. 로그에 fixture 기반 missing HOI4 asset `UserError`는 남지만 smoke assertions는 모두 통과했다.
- `npm run package` passed and produced `hoi4modutilities-1.0.0.vsix`.

# FocusTree Load Regression 2026-04-08

## Plan
- [x] 최근 focustree startup 변경으로 생긴 빈 캔버스 회귀를 실제 ready/update 경로 기준으로 좁힌다
- [x] 초기 로드 성능 개선은 유지하면서 focustree 데이터가 다시 보이도록 startup 경로를 보정한다
- [x] focus preview 회귀를 막는 검증을 보강하고 build/test로 다시 확인한다

## Review
- `src/previewdef/focustree/index.ts`는 shell-only 초기화로 완전히 건너뛰는 대신, webview ready 전에 계산한 `FocusTreeRenderBaseState`를 `pendingReadyBaseState`로 보관했다가 ready 직후 재사용하도록 바뀌었다. 그래서 첫 오픈에서 같은 focustree load를 두 번 하지 않으면서도, 기존 ready 이후 snapshot update 흐름은 그대로 유지된다.
- 이번 회귀는 “pre-ready full load를 아예 생략”한 최신 수정이 focustree startup의 실제 기대 흐름과 어긋난 데 있었다. toolbar shell은 뜨지만 ready 뒤 첫 rebuild에 필요한 실제 snapshot 준비가 보장되지 않아, 사용자 입장에서는 중점 정보가 비어 보이는 상태가 만들어졌다.
- `test/integration/extension.test.ts`에 representative focus fixture smoke를 추가해, 적어도 focus preview command가 실제로 열리는 경로가 앞으로 기본 UI smoke에서 빠지지 않게 했다.
- 교훈적으로는 focustree startup 최적화에서 shell 렌더와 data snapshot 준비를 완전히 분리하기보다, pre-ready에서 이미 계산한 결과를 ready 후 재사용하는 편이 더 안전한 설계였다.

## Verification
- `npm run compile-ts` passed.
- `npm run lint` passed.
- `npm run test` passed.
- `npm run test-ui` passed with the new focus preview smoke check included.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.

# FocusTree Root Load Refactor 2026-04-08

## Plan
- [x] focustree 첫 페인트 경로에서 구조 렌더와 무거운 자산 해석이 어떻게 섞여 있는지 다시 분리해 본다
- [x] 첫 오픈은 빠른 구조 snapshot으로 띄우고 아이콘/inlay 자산은 후속 hydration으로 미루는 근본 개선을 구현한다
- [x] focus preview가 계속 보이면서 점진적으로 보강되는지 build/test로 검증하고 결과를 남긴다

## Review
- `src/previewdef/focustree/loader.ts`는 이제 asset load mode를 받아서 첫 오픈의 deferred 경로에서는 구조 파싱, shared focus 해석, focus spacing만 우선 처리하고, icon fallback scan과 inlay GUI/GFX resolution은 뒤로 미룬다.
- `src/previewdef/focustree/contentbuilder.ts`는 deferred base state일 때 실제 icon 이미지를 찾지 않고 placeholder 스타일만 만들어 첫 tree body를 바로 그린다. inlay HTML도 첫 페인트에서는 비워 둔 뒤, 후속 full hydration에서 실제 자산이 붙는다.
- `src/previewdef/focustree/index.ts`는 초기 panel open에서 shell을 즉시 띄우고 deferred base-state preload를 시작한다. ready 후 첫 snapshot은 그 deferred 결과를 재사용하고, 바로 이어서 full asset refresh를 한 번 더 돌려 icons/inlays를 보강한다.
- `src/previewdef/focustree/renderpayloadpatch.ts`는 `deferredAssetLoad` 상태를 cache에 포함해, placeholder 기반 첫 snapshot에서 full asset snapshot으로 넘어갈 때 style/inlay 차이를 안전하게 full refresh로 승격한다.
- 이번 라운드의 핵심은 “초기 로딩이 느린 이유가 단순 중복 load만이 아니라, 첫 화면에 꼭 필요하지 않은 자산 해석까지 동기적으로 묶여 있었기 때문”이라는 점을 구조적으로 분리한 것이다.

## Verification
- `npm run compile-ts` passed.
- `npm run lint` passed.
- `npm run test` passed.
- `npm run test-ui` passed, including the focus preview smoke test.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.

# FocusTree Edit Reconcile Fix 2026-04-08

## Plan
- [x] focustree edit 메시지와 apply 후 refresh 경로를 다시 확인해 공통 실패 지점을 찾는다
- [x] create/move/link/delete를 모두 authoritative host refresh로 다시 reconcile하도록 보정한다
- [x] create 직후 host refresh 전에도 placeholder가 보이도록 webview fallback을 보강한다
- [x] 관련 테스트를 보강하고 compile/test로 회귀를 검증한다

## Review
- `src/previewdef/focustree/index.ts`는 이제 create, delete, drag move, continuous focus move, prerequisite link, mutually exclusive link가 모두 같은 `reconcileAfterLocalEdit()`를 타도록 바뀌었다. 즉 optimistic webview ack는 유지하되, 성공한 문서 편집은 항상 즉시 host-side `refreshDocument(..., { ignorePendingLocalEditDocumentVersion: true })`로 다시 파싱해 authoritative snapshot을 보낸다.
- 이번 회귀의 공통 원인은 일부 편집 경로가 local webview mutation에만 의존하고 host 재파싱은 정상 document-change 이벤트에 맡겨 두었던 점이었다. 최근 로딩 최적화 이후에는 이 경로가 더 취약해져서 create 외의 edit 기능이 실제 parsed preview 상태와 쉽게 어긋날 수 있었다.
- `src/previewdef/focustree/localpreview.ts`와 `webviewsrc/focustree.ts`는 아직 host가 새 `renderedFocus` 템플릿을 보내기 전에도 freshly created placeholder focus를 최소 카드로 렌더하도록 보강되었다. 그래서 double click create는 더 이상 빈 slot 상태로 남지 않고, 뒤따르는 authoritative refresh가 오면 실제 rendered template로 자연스럽게 교체된다.
- `test/unit/focustree-localpreview.test.ts`에는 pending placeholder 판별과 fallback template 생성 회귀 체크를 추가해, create 직후 프리뷰가 완전히 비어 버리는 문제를 다시 놓치지 않도록 했다.

## Verification
- `npm run compile-ts` passed.
- `npm run test` passed.
- `npm run test-ui` passed on rerun. 첫 시도는 VS Code test runtime mutex/launch race로 실패했지만, 같은 코드 상태에서 즉시 재실행 시 11 smoke tests가 모두 통과했다.

# FocusTree Edit Reflection Regression 2026-04-08

## Plan
- [x] create focus와 prerequisite link가 host patch 계산에서 어떤 changed slot/structure signal을 내는지 확인한다
- [x] 구조 변경이 incremental path에서 누락되지 않도록 patch/update 판단을 바로잡는다
- [x] 관련 regression test를 추가하고 compile/test로 다시 검증한다

## Review
- `src/previewdef/focustree/index.ts`의 edit 후 reconcile 경로는 이제 `forceFullSnapshot: true`와 `forceFullAssetLoad: true`를 함께 사용한다. 즉 create, prerequisite link, exclusive link, delete, drag move 후에는 slot-based partial patch 판단을 거치지 않고 항상 authoritative full snapshot update를 다시 보낸다.
- 이번 보정은 “edit 직후 반영”만큼은 로딩 최적화보다 정확성을 우선하도록 되돌린 것이다. 일반 문서 변경 refresh는 여전히 partial update 경로를 타지만, 사용자가 의도적으로 구조를 바꾸는 edit 액션은 전체 focustree snapshot을 다시 내려 주므로 create/link가 patch misclassification에 걸려 조용히 누락되는 경로를 차단한다.
- 추가 진단 결과, 문제의 핵심은 개별 create/link 텍스트 편집 함수보다 그 뒤의 incremental update 가정이 더 공격적이었다는 쪽에 가까웠다. 그래서 edit 성공 후 경로만 별도로 full snapshot으로 분기하는 편이 최소 수정으로 가장 안전했다.

## Verification
- `npm run compile-ts` passed.
- `npm run test` passed.
- `npm run test-ui` passed.

# FocusTree Edit Reflection Race 2026-04-08

## Plan
- [x] edit ack 직후 webview rebuild와 host snapshot update가 서로 덮어쓰는 race가 있는지 확인한다
- [x] stale async rebuild가 최신 authoritative snapshot DOM을 다시 덮지 못하도록 focustree webview rebuild 경로를 직렬화한다
- [x] 관련 회귀 테스트를 보강하고 compile/test로 다시 검증한다

## Review
- `webviewsrc/focustree.ts`의 `buildContent()`는 이제 `LatestOnlyBuildGuard` 토큰을 받아 가장 마지막에 시작한 rebuild만 DOM에 적용한다. 오래 걸리는 `renderGridBoxCommon()`이 늦게 끝나더라도, 그 사이 도착한 최신 host snapshot 이후 stale build 결과는 버려진다.
- 같은 파일의 `renderCurrentFocusHtml()`는 build-local render context를 받을 수 있게 바뀌어, async rebuild 중간에 전역 `currentRenderedExprs`나 `currentFocusPositions`가 다른 갱신에 의해 바뀌어도 해당 build가 캡처한 snapshot 기준으로만 렌더된다.
- checkbox 기반 자체 rebuild도 동일한 latest-only guard를 타게 정리해서, 조건 토글과 host refresh가 겹칠 때도 이전 build가 최신 트리를 다시 덮어쓰지 않도록 맞췄다.
- `src/previewdef/focustree/buildguard.ts`와 `test/unit/focustree-buildguard.test.ts`를 추가해, 새 build가 시작되면 이전 build token이 무효화되는 최소 회귀 조건을 unit test로 고정했다.

## Verification
- `npm run compile-ts` passed.
- `npm run test` passed.
- `npm run test-ui` passed. 이 저장소 fixture 특성상 missing HOI4 asset `UserError`와 VS Code runtime mutex 로그는 여전히 출력되지만, smoke assertions는 11개 모두 녹색이었다.

# FocusTree GitHub Baseline Investigation 2026-04-08

## Plan
- [x] GitHub 원격/태그/최근 이력을 확인해 focustree edit가 안정적이던 기준 버전을 찾는다
- [x] 기준 버전과 현재 버전의 focustree host/webview edit 반영 흐름을 비교해 빠진 동작을 특정한다
- [x] 필요한 부분만 최소 backport/adapt 하고 순차 검증으로 확인한다

## Review
- GitHub 기준선은 `v0.13.22`였다. 그 버전의 [src/previewdef/focustree/index.ts] 경로를 대조해 보니, 구조 편집 후에는 지금보다 단순한 full preview refresh 경로에 더 많이 의존하고 있었고, 최근 최적화 라운드에서 그 안정성이 약해진 상태였다.
- 현재 `src/previewdef/focustree/index.ts`는 `reloadPreviewAfterStructuralEdit()`를 추가해 create/prerequisite/exclusive/delete 같은 구조 편집 뒤에는 full focustree HTML을 다시 생성해 panel에 교체한다. 이 경로는 `renderFocusTreeFile()`를 직접 써서 shell-ready-snapshot 체인이나 patch merge에 의존하지 않는다.
- 좌표 이동 같은 빈번한 편집은 기존 `reconcileAfterLocalEdit()` 기반 빠른 refresh를 유지하고, 구조 편집만 구 버전식 안정 경로로 분리했다. 즉 성능 최적화는 남기되, 사용자가 문제를 겪은 create/link 계열만 우선 정확성으로 되돌린 셈이다.
- 앞서 추가한 webview `LatestOnlyBuildGuard`는 그대로 유지해, full reload 이전/이후에 남아 있던 늦은 async rebuild가 최신 DOM을 다시 덮지 못하게 한다.

## Verification
- `npm run compile-ts` passed.
- `npm run test` passed.
- `npm run test-ui` passed. 이 저장소 fixture 특성상 missing HOI4 asset `UserError`와 VS Code runtime mutex 로그는 남지만, smoke assertions는 11개 모두 녹색이었다.

# FocusTree Stable Rewrite 2026-04-09

## Plan
- [x] `v0.13.22` 기준선과 현재 focustree host/webview 흐름을 다시 대조해, 유지할 현재 기능 계약과 버릴 내부 복잡도를 명시한다
- [x] focustree host orchestration을 안정 버전식 명시적 단계로 재작성한다
- [x] webview update 적용 경로를 host 계약에 맞게 단순화하고 current feature set을 유지한다
- [x] 회귀 테스트를 새 구조 기준으로 정리하고 필요한 경우 추가한다
- [x] compile/test로 검증하고 review/verification 결과를 남긴다

## Notes
- 사용자 요청: 이전 안정 버전을 참고하되, 현재 포커스 기능은 전부 유지하면서 focus 관련 기능을 사실상 새로 쓴다.
- 기준선: `v0.13.22`의 강점은 구조 편집 후 full refresh 기준이 단순하고 예측 가능했다는 점이다.
- 현재 유지 대상:
- 조건 선택 및 preset 저장/복원
- edit mode, drag move, continuous focus move, blank-space create, delete, prerequisite/exclusive link 편집
- multi-select, hover relation highlight, inlay window 선택, warning/selector UI, retain-context 기반 reopen 안정성
- optimistic local preview와 authoritative host reconcile의 조합
- 재작성 목표:
- `src/previewdef/focustree/index.ts` 중심의 refresh/edit orchestration을 작은 단계와 명시적 상태 전이로 다시 정리한다
- 가능한 범위에서 host/webview update 계약을 단순화해 “stable baseline의 예측 가능성 + current feature set”을 같이 만족시킨다
- 완료 조건:
- focus preview가 열리고, 기존 edit 동작들이 회귀 없이 유지되며, 관련 unit/integration 테스트가 통과한다

## Review
- `src/previewdef/focustree/previewsession.ts`를 새로 추가해 focustree preview의 실제 상태 기계를 `initialize -> preload -> ready refresh -> deferred hydration -> local edit reconcile -> structural reload` 단계로 분리했다. 이전 안정 버전의 예측 가능한 full-refresh 사고방식을 유지하면서, 현재 버전의 deferred preload와 snapshot update 흐름도 같은 세션 안에서 관리하게 됐다.
- `src/previewdef/focustree/index.ts`는 이제 preview definition, preset persistence, 그리고 edit command routing만 담당한다. 기존에는 shell 렌더링, refresh request 경쟁 제어, pending base-state 재사용, local edit reconcile, structural full reload가 한 파일에 섞여 있었는데, 이번에 host orchestration을 세션 클래스로 내려서 책임을 분리했다.
- current feature set은 유지했다. 조건 preset 저장/복원, drag/continuous move의 optimistic ack 후 authoritative reconcile, create/delete/link/exclusive의 structural reload, retain-context 기반 reopen, 그리고 기존 webview message contract는 그대로 남겼다.
- 결과적으로 이번 라운드는 patch 알고리즘이나 webview affordance를 바꾸기보다, `v0.13.22`의 안정적인 refresh 모델을 현재 기능 집합 위에 다시 세운 재구성에 가깝다. 이후 focus 관련 회귀가 나와도 host-side 상태 전이를 한 곳에서 추적할 수 있게 됐다.

## Verification
- `npm run compile-ts` passed.
- `npm test` passed.
- `npm run test-ui` passed.
- 참고: 첫 `npm test` 실패는 코드 문제보다 `npm test`와 `npm run test-ui`를 동시에 돌리며 `static/` 빌드 산출물을 건드린 병렬 실행 레이스였다. 같은 코드 상태에서 순차 재실행 시 모두 통과했다.
- 2026-04-09 재검증에서도 같은 결론을 확인했다. 병렬 실행 시 `clean:out`/`compile-tests` 경쟁으로 `test-ui`가 흔들릴 수 있지만, 순차 실행에서는 focus preview smoke를 포함한 11개 UI 테스트가 통과했다.
