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

# Focus Subsystem Clean Rewrite 2026-04-09

## Plan
- [x] `v0.13.21` 기준 동작과 현재 HEAD의 추가 기능 계약을 동시에 만족하는 새 focustree 내부 타입과 계층을 도입한다
- [x] host 쪽을 `snapshot builder` / `patch planner` / `loader adapter` / `edit command handler` / `session controller` 구조로 재편한다
- [x] webview focustree 엔트리를 상태 저장소와 메시지 적용 계층으로 분리해 모놀리식 구조를 줄인다
- [x] focustree session/patch/webview 회귀 테스트를 새 구조 기준으로 보강한다
- [x] `npm run compile-ts`, `npm run build`, `npm run lint`, `npm run test:unit`, `npm run test-ui`로 검증하고 review/verification을 남긴다

## Notes
- 사용자 요청: 이전 안정 버전 `v0.13.21`을 기준선으로 삼되, 이후 추가된 현재 기능과 성능 특성까지 유지하면서 포커스 관련 기능을 전부 다시 작성한다.
- 유지 대상: 관계 하이라이트, minimap, condition/tree selector, inlay, shared/joint focus, edit mode drag/create/delete/link/exclusive, multi-select, preset 저장/복원, tree-id 기반 selection 유지, deferred/full asset load, snapshot-based incremental update.

## Review
- `src/previewdef/focustree/runtime.ts`를 추가해 세션이 공유하는 내부 기준 타입을 `FocusTreeSnapshot`, `FocusTreePatchPlan`, `FocusTreeRuntimeState`, `FocusTreeSelectionState`, `FocusTreeLocalEditResult`로 명시했다. 새 세션/테스트는 이 타입을 기준으로 움직이고, 기존 외부 webview message 이름은 유지했다.
- `src/previewdef/focustree/loaderadapter.ts`, `src/previewdef/focustree/snapshotbuilder.ts`, `src/previewdef/focustree/patchplanner.ts`, `src/previewdef/focustree/edithandler.ts`를 추가해 host 쪽 책임을 나눴다. 이제 loader snapshot 생성, full snapshot 조립, partial/full patch 결정, workspace edit 적용이 `previewsession.ts`와 `index.ts`에 직접 섞이지 않는다.
- `src/previewdef/focustree/previewsession.ts`는 새 runtime state와 injected builder/planner를 사용하는 session controller로 정리되었다. pre-ready shell fallback, pending base-state 재사용, partial/full snapshot posting, stale refresh discard, local edit reconcile, structural full reload가 하나의 상태 기계로 정리됐다.
- `src/previewdef/focustree/index.ts`는 preset persistence와 panel lifecycle, message routing만 남기고 실제 편집 명령 적용은 `FocusTreeEditCommandHandler`로 옮겨 얇은 facade로 축소했다.
- `webviewsrc/focustree/state.ts`를 추가해 persisted selection/search/preset/edit-mode 초기화를 한 곳으로 모았고, `webviewsrc/focustree/messageapply.ts`를 추가해 host `focusTreeContentUpdated` payload 적용 로직을 별도 모듈로 분리했다. `webviewsrc/focustree.ts`는 이 모듈들을 사용하도록 바뀌어 모놀리식 entry의 중심 상태/메시지 축을 떼어냈다.
- 기존 기능 계약은 유지했다. focus preview open, selection/tree restore, condition preset persistence, incremental snapshot update, structural full reload, optimistic local edit ack 후 authoritative reconcile, retained webview context 흐름은 그대로 작동한다.
- 회귀 테스트를 보강했다. `test/unit/focustree-runtime.test.ts`, `test/unit/focustree-messageapply.test.ts`, `test/unit/focustree-previewsession.test.ts`를 추가해 runtime/session/message-apply 경계를 직접 검증하도록 했다.

## Verification
- `npm run compile-ts` passed.
- `npm run build` passed.
- `npm run lint` passed.
- `npm run test:unit` passed with 127 tests.
- `npm run test-ui` passed with 11 smoke tests.
- 참고: `test-ui` 실행 로그에는 fixture 특성상 missing HOI4 asset `UserError`와 VS Code mutex 경고가 계속 나오지만, smoke assertions는 모두 통과했다.

# Focus Stable Rewrite v0.13.20 2026-04-09

## Plan
- [x] `v0.13.20` focustree 기준선과 현재 HEAD 기능 계약을 다시 대조해 유지/단순화 범위를 고정한다
- [x] `tasks/todo.md` 기준으로 host focus preview orchestration을 안정 버전식 명시적 흐름으로 재작성한다
- [x] 현재 추가 기능을 유지하는 선에서 edit/session/update 경로를 새 host 흐름에 맞게 다시 묶는다
- [x] 필요한 테스트를 갱신 또는 추가하고 순차 검증으로 compile/test-ui까지 확인한다

## Notes
- 사용자 요청: 이전 안정 버전 `v0.13.20`을 표준으로 삼되, 이후 새로 생성된 focus 기능은 유지하면서 관련 코드를 전부 다시 쓴다.
- 기준선에서 가져올 핵심:
- `index.ts` 중심의 단순한 refresh 수명주기
- webview ready 전/후의 예측 가능한 full refresh 우선 정책
- 구조 편집 후에는 복잡한 부분 갱신보다 안정적인 전체 재구성 우선
- 현재 유지 대상:
- condition selector 및 preset 저장/복원
- drag move, continuous focus move, blank-space create, delete, prerequisite/exclusive link 편집
- multi-select, hover relation highlight, inlay window, warning/selector UI
- retain-context 기반 reopen 안정성, optimistic local preview, snapshot-based update

## Review
- `src/previewdef/focustree/previewsession.ts`를 `v0.13.20` 스타일의 직접 상태 머신으로 다시 썼다. pending local edit, webview ready, pending base state, deferred hydration, latest request id를 세션 내부 필드로 직접 관리해 refresh 흐름을 한 파일에서 따라갈 수 있게 했다.
- `loaderadapter.ts`, `snapshotbuilder.ts`, `patchplanner.ts`, `runtime.ts`의 얇은 host 래퍼 계층을 제거했다. 실제 shell 렌더, base state 생성, full snapshot 생성, partial/full update 결정은 이제 `previewsession.ts`가 직접 수행한다.
- 구조 편집과 일반 편집의 경계는 유지했다. 이동류 edit는 optimistic ack 뒤 authoritative full snapshot reconcile을 계속 사용하고, create/delete/link/exclusive 같은 구조 편집은 기존처럼 full document reload 경로를 사용한다.
- `src/previewdef/focustree/edithandler.ts`는 세션의 새 계약에 맞게 정리했다. edit handler가 더 이상 별도 runtime result 객체를 만들지 않고, 문서 버전만 바로 사용한다.
- `test/unit/focustree-previewsession.test.ts`는 새 세션 계약 기준으로 다시 썼다. shell fallback, cached base state 재사용, partial update, stale refresh discard, local edit reconcile, structural reload를 직접 검증한다.
- 결과적으로 host 쪽 focus preview는 `v0.13.20`의 예측 가능한 수명주기 쪽으로 되돌아갔고, 이후 추가된 preset/deferred asset load/incremental snapshot 기능은 그 위에 유지됐다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 123 tests.
- `npm install` ran to restore the missing local `esbuild` dependency that blocked `npm run build`/`npm run test-ui` in this workspace.
- `npm run test-ui` passed with 11 smoke tests, including the focus preview fixture.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# Focus Strict Rollback v0.13.20 2026-04-09

## Plan
- [x] `v0.13.20` 기준 파일 구성을 다시 확인하고, 기준선에 없는 host helper를 제거할지 여부를 정한다
- [x] focus host orchestration을 다시 `index.ts` 중심 구조로 되돌리고 추가 기능만 최소 범위로 접합한다
- [x] rollback 후 compile, unit, UI smoke, VSIX packaging까지 순차 검증한다

## Notes
- 사용자 요청: 추가된 기능과 명시적으로 유지해야 하는 수정 기능만 남기고, 그 외 focus 관련 host 구조는 가능한 한 `v0.13.20` 기준으로 되돌린다.
- 이번 라운드의 핵심은 “새 구조를 더 정리”하는 것이 아니라, 기준선에 없던 host orchestration 파일들을 걷어내고 실제 기준 파일인 `index.ts`로 수명주기를 되돌리는 것이었다.

## Review
- `src/previewdef/focustree/index.ts`가 다시 focus preview host의 중심이 되었다. `v0.13.20`처럼 preview lifecycle, document refresh, local edit apply, structural reload, webview ready 처리를 한 클래스 안에서 직접 따라갈 수 있게 정리했다.
- 기준선에 없던 host helper인 `src/previewdef/focustree/edithandler.ts`, `src/previewdef/focustree/previewsession.ts`, `src/previewdef/focustree/loaderadapter.ts`, `src/previewdef/focustree/snapshotbuilder.ts`, `src/previewdef/focustree/patchplanner.ts`, `src/previewdef/focustree/runtime.ts`를 제거했다.
- 다만 현재 명시적으로 유지해야 하는 이후 기능은 그대로 접합했다. condition preset 저장/복원, continuous focus move, grouped prerequisite link/delete payload, deferred/full asset load, incremental snapshot update, retain-context panel 옵션은 새 `index.ts` 안으로 다시 녹였다.
- 테스트도 기준선에 없는 세션 전용 회귀 테스트를 함께 제거했다. `test/unit/focustree-previewsession.test.ts`와 `test/unit/focustree-runtime.test.ts`는 삭제됐고, 남아 있는 focus unit/UI 검증은 현재 기능 계약 기준으로 계속 통과한다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 117 tests.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 보이지만, smoke assertions는 모두 통과했다.

# Focus Full Rollback v0.13.20 2026-04-10

## Plan
- [x] `v0.13.20` 태그의 실제 focus 관련 파일 집합을 다시 확인한다
- [x] focus source, webview, unit tests를 `v0.13.20` 스냅샷으로 그대로 복원한다
- [x] 태그에 없던 focus 전용 파일과 테스트를 제거한다
- [x] compile, unit, UI smoke, VSIX packaging까지 순차 검증한다

## Notes
- 사용자 보정: "더 공격적으로, 완전히 롤백"
- 이번 라운드는 이전처럼 `v0.13.20` 구조 위에 이후 기능을 다시 얹는 것이 아니라, 포커스 서브시스템 자체를 태그 시점의 파일 구성과 구현으로 최대한 그대로 되돌리는 작업이다.
- 대상 기준 파일:
- `src/previewdef/focustree/{contentbuilder,focusspacing,index,inlay,loader,positioneditcommon,positioneditmetadata,positioneditservice,positioning,schema}.ts`
- `[webviewsrc/focustree.ts](C:\Users\Administrator\Documents\Code\hoi4modutilities\webviewsrc\focustree.ts)`
- `test/unit/focustree-{focusspacing,positionedit,schema}.test.ts`

## Review
- 포커스 서브시스템의 기준 파일들을 `v0.13.20` 내용으로 직접 복원했다. 대상은 `src/previewdef/focustree/{contentbuilder,focusspacing,index,inlay,loader,positioneditcommon,positioneditmetadata,positioneditservice,positioning,schema}.ts`, `webviewsrc/focustree.ts`, `test/unit/focustree-{focusspacing,positionedit,schema}.test.ts`였다.
- 태그에 없던 focus 전용 파일은 전부 제거했다. `buildguard`, `conditionexprs`, `conditionpresets`, `focusicongfx`, `focusiconlayout`, `focuslint`, `focusrender`, `hoverrelations`, `inlayshared`, `layoutplan`, `localpreview`, `relationanchor`, `renderpayloadpatch`, `selectionstate`, `webviewupdate`와 이전에 도입했던 host helper(`edithandler`, `previewsession`, `loaderadapter`, `snapshotbuilder`, `patchplanner`, `runtime`)가 모두 정리됐다.
- webview 쪽도 `webviewsrc/focustree.ts`를 태그 기준으로 되돌리고, 태그에 없던 `webviewsrc/focustree/messageapply.ts`, `webviewsrc/focustree/state.ts`를 제거했다.
- 테스트는 `v0.13.20`에 맞는 focus 단위 테스트만 남겼다. 그 결과 focus 관련 unit suite는 58개 테스트 수준으로 줄었고, 이후 추가된 focustree 전용 회귀 테스트들은 함께 제거됐다.
- 현재 코드베이스와의 접합 때문에 `src/previewdef/focustree/index.ts`에는 한 가지 최소 적응만 남겼다. 구버전의 preview 등록 방식을 현재 `PreviewDescriptor` 계약에 맞게 바꾼 부분이다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 58 tests.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# Focus Feature-Preserving Rollback Correction 2026-04-10

## Plan
- [x] 사용자 보정을 작업 문서와 lessons에 기록한다
- [x] focus 관련 소스, webview, tests를 feature-complete 커밋 기준으로 복구해 롤백 이전 기능을 다시 모두 살린다
- [x] compile, unit, UI smoke, VSIX packaging으로 feature-complete 상태를 다시 검증한다

## Notes
- 사용자 보정: "롤백하되 롤백 이전 기능을 전부 유지", "변경된 기능들도 유지"
- 따라서 이번 라운드는 exact `v0.13.20` file-set restore를 유지하는 것이 아니라, 직전 aggressive rollback으로 제거된 focus 기능들을 먼저 모두 복구하는 작업이다.
- 복구 기준은 `568a90b`의 focustree file-set이다. 이 시점은 `v0.13.20` 기반 재작성 이후 기능 보존 상태를 포함하고 있어서, exact tag restore보다 사용자 요구에 더 가깝다.

## Review
- `src/previewdef/focustree/`는 `568a90b` 기준의 feature-complete 구조로 복구했다. `buildguard`, `conditionexprs`, `conditionpresets`, `focusicongfx`, `focusiconlayout`, `focuslint`, `focusrender`, `hoverrelations`, `inlayshared`, `layoutplan`, `localpreview`, `relationanchor`, `renderpayloadpatch`, `selectionstate`, `webviewupdate`와 session helper(`edithandler`, `previewsession`, `loaderadapter`, `patchplanner`, `runtime`, `snapshotbuilder`)를 다시 살렸다.
- `src/previewdef/focustree/index.ts`, `contentbuilder.ts`, `loader.ts`, `schema.ts`, `positioneditcommon.ts`, `positioneditmetadata.ts`, `positioneditservice.ts`, `webviewsrc/focustree.ts`도 함께 복구해, rollback 전 호스트/웹뷰 계약과 이후 변경 기능이 다시 같은 경로에서 동작하도록 맞췄다.
- 웹뷰 상태/메시지 계층도 `[webviewsrc/focustree/state.ts](C:\Users\Administrator\Documents\Code\hoi4modutilities\webviewsrc\focustree\state.ts)`, `[webviewsrc/focustree/messageapply.ts](C:\Users\Administrator\Documents\Code\hoi4modutilities\webviewsrc\focustree\messageapply.ts)`까지 함께 복원했다.
- focus 회귀 테스트도 feature-complete 세트로 되돌렸다. preset, hover relation, local preview, patch planner/session/runtime, selection state 관련 unit tests가 다시 포함됐다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 127 tests.
- `npm run test-ui` passed with 11 smoke tests, including the focus preview fixture.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Regression Fixes 2026-04-10

## Plan
- [x] 현재 focustree 회귀 증상과 host/webview 계약을 다시 조사한다
- [x] 아이콘 렌더, 구조 편집 즉시 반영, continuous focus 편집 회귀를 수정한다
- [x] 관련 unit 검증과 VSIX packaging까지 다시 완료한다

## Notes
- 사용자 보고 증상:
- 최신 빌드에서 focus 아이콘이 뜨지 않는다
- 더블 클릭 생성 focus가 바로 반영되지 않는다
- `continuous_focus` 수정이 작동하지 않는다
- 그 외 `v0.13.20`에서 되던 포커스 편집 기능들이 함께 흔들린다
- 1차 분석:
- 웹뷰는 `createFocusTemplateApplied`, `deleteFocusApplied`, `focusLinkEditApplied`, `focusExclusiveLinkEditApplied` 기반 local preview 경로를 가지고 있지만, 현재 host edit handler는 성공한 구조 편집 뒤에 full reload만 하고 즉시 ack를 거의 보내지 않는다
- `continuousFocuses` shell element는 현재 placeholder/inlay DOM보다 낮은 `z-index`로 렌더되어 실제 pointer hit가 막힐 가능성이 있다
- focus icon resolver는 resolved gfx file set이 놓친 경우 index 기반 `getSpriteByGfxName()` fallback을 다시 시도하는 편이 안전하다

## Review
- `src/previewdef/focustree/edithandler.ts`는 성공한 구조 편집 뒤에도 즉시 ack를 보내도록 다시 맞췄다. `createFocusTemplateApplied`, `deleteFocusApplied`, `focusLinkEditApplied`, `focusExclusiveLinkEditApplied`를 full reload 전에 먼저 보내서 웹뷰의 local preview 경로가 다시 동작한다.
- `src/previewdef/focustree/contentbuilder.ts`는 `continuousFocuses` shell element를 focus/inlay placeholder 위로 올려 실제 pointer hit가 가능하게 했고, focus icon lookup도 resolved gfx file set이 놓친 경우 `getSpriteByGfxName()` fallback을 다시 타도록 보강했다.
- `test/unit/focustree-edithandler.test.ts`를 추가해 create/delete/link/exclusive 구조 편집이 모두 optimistic ack 후 structural reload 순서로 처리되는 회귀 조건을 고정했다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 131 tests.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Stable Baseline Recovery 2026-04-10

## Plan
- [x] 현재 focustree host/session/payload 경로를 `v0.13.20` full-refresh 기준과 다시 맞춘다
- [x] 아이콘 로드와 create/link/continuous 편집 반영을 incremental patch가 아닌 full snapshot 기준으로 복구한다
- [x] compile, unit, UI smoke, VSIX packaging으로 다시 검증한다

## Notes
- 사용자 보정: 이전 회귀 수정 후에도 `v0.13.20`에서 되던 기능들과 아이콘 표시가 여전히 깨져 있다.
- 이번 라운드에서는 개별 증상 패치보다, focus host를 `v0.13.20`식 full-refresh/full-asset 우선 경로로 단순화해 표준 동작을 먼저 회복하는 쪽이 우선이다.

## Review
- `src/previewdef/focustree/previewsession.ts`는 incremental patch/deferred hydration 우선 경로를 걷어내고, `v0.13.20`처럼 full render/full asset 우선 세션으로 다시 단순화했다. 웹뷰가 아직 준비되지 않았을 때와 구조 편집 직후에는 곧바로 전체 문서를 다시 렌더하고, 웹뷰 준비 후 일반 갱신도 full snapshot만 보내도록 정리했다.
- 같은 맥락에서 local edit 후 reconcile도 부분 patch 강제가 아니라 full snapshot 재동기화로 돌려, create/link/delete/continuous 편집 뒤의 표준 동작을 더 예측 가능하게 만들었다.
- `src/previewdef/focustree/index.ts`는 panel 초기화 때 세션 full render를 기다리도록 바꿔 첫 오픈도 shell-only 경로에 묶이지 않게 했다.
- `src/previewdef/focustree/edithandler.ts`는 타입 전용 import를 `import type`으로 바꿔, edit handler 테스트나 경량 로드에서 불필요하게 전체 focustree 세션/loader 체인이 함께 올라오지 않게 정리했다.
- `test/unit/focustree-previewsession.test.ts`는 새 세션 계약에 맞게 다시 맞췄다. 이제 webview 미준비 상태의 full render, panel 초기화 full render, webview ready 이후 full snapshot, stale refresh discard, local edit reconcile, structural reload를 직접 검증한다.

## Verification
- `npm run test:unit` passed with 131 tests.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and produced `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Loading Recovery 2026-04-10

## Plan
- [x] focustree 초기 panel open과 구조 재로드가 full asset render를 기다리며 막히는지 점검한다
- [x] shell-first initial load를 복구하되, ready 이후 full snapshot/full asset reconcile은 유지한다
- [x] unit, UI smoke, VSIX packaging으로 다시 검증한다

## Notes
- 사용자 보정: 이번 라운드에서는 포커스 프리뷰가 아예 로드되지 않는다.
- 의심 경로: `previewsession.ts`가 초기 panel open과 구조 재로드에서도 `renderDocument()` full render를 바로 기다리도록 바뀌면서, 누락되거나 차가운 asset 로드가 첫 표시 자체를 막고 있을 수 있다.

## Review
- `src/previewdef/focustree/previewsession.ts`는 initial panel open과 structural reload를 다시 shell-first로 돌렸다. 이제 처음 열릴 때와 구조 편집 뒤에는 즉시 shell HTML을 보여 주고, 웹뷰가 `focusTreeWebviewReady`를 보낸 뒤에만 full snapshot/full asset reconcile을 수행한다.
- 동시에 ready 이후 일반 문서 갱신은 이전 라운드처럼 incremental patch가 아니라 full snapshot만 보내도록 유지해서, 로딩 회복과 표준 편집 반영 안정성을 같이 맞췄다.
- `test/unit/focustree-previewsession.test.ts`도 새 계약에 맞게 고쳐, 미준비 상태 shell 유지, panel 초기화 shell, ready 이후 full snapshot, local edit reconcile, structural reload를 검증하도록 했다.

## Verification
- `npm run test:unit` passed with 131 tests.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Blank Canvas Recovery 2026-04-10

## Plan
- [x] shell은 보이지만 tree body가 비는 현재 focustree ready/apply 경로를 추적한다
- [x] selected tree/state apply 계약을 고쳐 실제 focus body가 다시 렌더되게 한다
- [x] unit, UI smoke, VSIX packaging으로 다시 검증한다

## Notes
- 사용자 스크린샷: toolbar는 보이지만 실제 focus tree body는 비어 있다.
- 이번 라운드는 "첫 로드 지연"이 아니라 shell 이후 ready-time snapshot/state apply 또는 selected tree 복원 경로가 어긋났는지 확인하는 작업이다.

## Review
- `src/previewdef/focustree/previewsession.ts`는 마지막으로 본 문서를 세션에 보관하도록 바뀌었다. 이제 `focusTreeWebviewReady` 시점에 `getDocumentByUri()`가 문서를 못 찾아도, 초기 panel open이나 직전 refresh에서 본 문서로 full snapshot 동기화를 계속 수행한다.
- 같은 파일의 shell replace guard도 workspace 조회와 세션 기억 문서 둘 다 기준으로 보도록 해, shell-first 초기화 이후 ready 시점에 동기화가 조용히 건너뛰는 상황을 줄였다.
- `test/unit/focustree-previewsession.test.ts`에는 workspace 조회가 실패해도 마지막 초기화 문서를 사용해 `focusTreeContentUpdated`를 보내는 회귀 테스트를 추가했다.

## Verification
- `npm run test:unit` passed with 132 tests.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Blank Canvas Deep Trace 2026-04-10

## Plan
- [x] 사용자 재보정을 작업 문서와 lessons에 기록한다
- [x] focustree body 렌더 입력을 직접 추적해 빈 캔버스가 `layoutPlan` 문제인지 `renderedFocus` payload 문제인지 확인한다
- [x] `v0.13.20` 표준 동작을 해치지 않으면서 최소 수정으로 본문 렌더를 복구한다
- [x] compile, unit/UI 검증, VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재보정: "아직도 여전함"
- 이전 라운드의 selected-tree/condition 기본값 수정만으로는 실제 blank canvas가 해결되지 않았다.
- 이번 라운드는 shell 이후 본문 렌더 입력 자체를 확인하는 것이 목표다. 특히 현재 tree의 `layoutPlan.focusGridBoxItems`와 `renderedFocus` 맵이 실제로 채워지는지 먼저 확인한다.

## Review
- `v0.13.20`의 `webviewsrc/focustree.ts`와 현재 구현을 직접 대조한 결과, 예전에는 "조건 선택 때문에 결과 focus가 0개가 되면 `selectedExprs`를 비우고 다시 렌더"하는 fallback이 있었는데 현재 구조화 과정에서 그 보호 장치가 사라져 있었다.
- 이를 현재 구조에 맞게 `src/previewdef/focustree/layoutplan.ts`의 `resolveFocusTreeLayoutPlan()`으로 복구했다. 이 helper는 현재 선택으로 `layoutPlan.focusGridBoxItems`가 비고 실제 tree에는 focus가 남아 있으면, `has_focus_tree`와 checked focus만 남긴 fallback expr로 다시 layout plan을 계산한다.
- `webviewsrc/focustree.ts`는 그 helper가 fallback을 사용했다고 알려 줄 때만 `selectedExprs`를 실제로 비우고 persisted state, conditions dropdown, preset UI를 함께 정리하도록 연결했다. 따라서 표준 `v0.13.20` 복구 동작은 되살리면서 이후 추가된 preset/state 구조도 유지된다.
- `test/unit/focustree-layoutplan.test.ts`에는 persisted condition 조합이 전체 tree를 숨기는 상황에서 fallback이 다시 tree body를 살리는 회귀 테스트를 추가했다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 133 tests.
- `npm run build` passed.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui`는 preview open smoke를 통과했지만 실제 blank-canvas 픽셀 단위 검증까지 하지는 않는다. 다만 이번 수정은 바로 그 blank-canvas 보호 경로를 unit test로 고정했다.

# FocusTree Runtime Trace 2026-04-10

## Plan
- [x] 반복된 사용자 보정을 lessons/todo에 기록한다
- [x] focustree shell bootstrap, ready message, content update apply, body rebuild 순서를 다시 추적한다
- [x] 실제로 본문 렌더를 건너뛰는 지점을 최소 수정으로 복구한다
- [x] 검증과 VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재보정: "..아직도 여전함"
- empty-selection fallback을 복구한 뒤에도 실제 사용자 환경에서는 blank canvas가 계속되고 있다.
- 이번 라운드는 조건 필터가 아니라 runtime 순서 문제를 우선 본다. 특히 shell-first 초기화 이후 `focusTreeContentUpdated` 적용과 `buildContent()` 호출 시점의 실제 데이터가 비어 있지 않은지 확인한다.

## Review
- `webviewsrc/focustree/messageapply.ts`에서 full tree update를 적용할 때, 현재 구현은 host가 보낸 `selectedTreeId`보다 "이전 선택 tree id"를 무조건 우선하고 있었다. 이 때문에 shell-first 초기화 후 복원된 예전 tree id가 현재 snapshot에 존재하지 않아도, 새 snapshot의 기본 tree로 이동하지 못하고 잘못된 index/selection에 머물 수 있었다.
- 이 경로를 고쳐서, full snapshot의 `focusTrees` 안에 이전 선택 id가 실제로 존재할 때만 그것을 유지하고, 그렇지 않으면 host가 보낸 `selectedTreeId`로 선택을 복구하도록 했다.
- `test/unit/focustree-messageapply.test.ts`에는 "복원된 tree id가 현재 snapshot에 없으면 host-selected tree를 따른다"는 회귀 테스트를 추가했다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 134 tests.
- `npm run build` passed.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.

# FocusTree Host Startup Trace 2026-04-10

## Plan
- [x] 반복된 사용자 보정을 lessons/todo에 기록한다
- [x] focustree host의 초기 `selectedTreeId`, snapshot tree ordering, stale session 상태를 추적한다
- [x] 실제 초기 body 렌더를 깨는 지점을 최소 수정으로 복구한다
- [x] compile, unit/UI 검증, VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재보정: "동일한 문제 아직도 여전함"
- 이전 라운드의 webview-side selected tree/state apply 수정만으로는 실제 사용자 환경의 blank canvas가 해결되지 않았다.
- 이번 라운드는 browser restore path가 아니라 host startup data를 우선 추적한다. 특히 host가 어떤 tree를 기본 선택으로 보냈는지, 그 값이 현재 문서와 맞는지, 그리고 세션 리셋 뒤에도 stale flag가 남아 첫 authoritative refresh를 건너뛰지 않는지 확인한다.

## Review
- 반복 보고를 기준으로 shell-first/message-first 부팅 경로를 다시 확인한 결과, blank canvas와 아이콘/편집 회귀를 한 번에 설명하는 가장 큰 차이는 `v0.13.20`의 full HTML refresh 기준을 현재 세션이 벗어나 있었다는 점이었다.
- `src/previewdef/focustree/previewsession.ts`를 안정 버전 쪽에 가깝게 단순화했다. 이제 초기 open, 일반 문서 변경, structural reload 모두 `renderDocument()` 기반 full HTML refresh를 사용하고, `focusTreeWebviewReady`는 추가 refresh를 강제하지 않고 ready 플래그만 갱신한다.
- 이 변경으로 shell HTML만 먼저 띄운 뒤 `focusTreeContentUpdated` 메시지로 본문을 채우던 경로가 초기 렌더의 주 경로에서 빠졌다. 결과적으로 v0.13.20에서 동작하던 bootstrap 계약에 더 가까워졌고, current webview state/preset 구조와 edit ack 경로는 그대로 유지된다.
- `test/unit/focustree-previewsession.test.ts`도 새 기준에 맞춰 갱신했다. 세션 테스트는 now-ready 상태에서도 full HTML refresh를 사용한다는 점, stale refresh가 최신 HTML을 덮지 못한다는 점, local/structural edit 후 full HTML이 다시 로드된다는 점을 검증한다.

## Verification
- `npm run test:unit` passed with 134 tests.
- `npm run build` passed.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Panel Init Trace 2026-04-10

## Plan
- [x] 반복된 사용자 보정을 lessons/todo에 기록한다
- [x] shared preview panel 초기화 계약과 focustree session의 full-refresh 변경을 대조한다
- [x] 첫 paint를 복구하는 최소 startup 수정 적용
- [x] compile, unit/UI 검증, VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재보정: "이번엔 또 공백 상태의 무한 로딩."
- 스크린샷은 이전의 toolbar-only blank canvas와 다르게, 아예 webview HTML이 아직 올라오지 않은 초기 blank 상태로 보인다.
- 이번 라운드는 focustree 내부 tree/body 선택보다 panel initialization contract를 먼저 본다. 특히 `initializePanelContent()`가 오래 걸리거나 실패할 때 상위 preview가 어떤 상태에 머무는지 확인한다.

## Review
- 원인은 `src/previewdef/focustree/index.ts`의 custom `initializePanelContent()` 경로와 `src/previewdef/previewbase.ts`의 공통 초기화 계약 사이에서 생겼다. focustree 세션이 첫 open 때 `renderDocument()` full refresh를 끝까지 `await`하도록 바뀌면서, 공통 `Loading...`/즉시 HTML 세팅 보호를 우회한 채 panel이 빈 상태로 오래 머물 수 있었다.
- `src/previewdef/focustree/previewsession.ts`의 `initializePanel()`을 다시 조정해서, 첫 open에서는 shell HTML을 즉시 넣고 full refresh는 비동기로 이어지게 했다. 따라서 첫 paint는 바로 뜨고, 이후 authoritative full render는 계속 유지된다.
- `test/unit/focustree-previewsession.test.ts`도 이 계약에 맞춰 갱신했다. 이제 초기화 테스트는 shell이 먼저 보이고 이후 full HTML로 교체된다는 점을 검증한다.

## Verification
- `npm run test:unit` passed with 134 tests.
- `npm run build` passed.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Renderable Selection Trace 2026-04-10

## Plan
- [x] 반복된 사용자 보정을 lessons/todo에 기록한다
- [x] 첫 full HTML 경로에서 selected tree, layout plan, rendered focus map의 실제 렌더 가능 여부를 추적한다
- [x] 렌더 불가능한 현재 선택을 자동 보정하는 최소 수정 적용
- [x] compile, unit/UI 검증, VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재보정: "..."
- 최신 스크린샷은 panel 초기화는 살아났지만, focus tree selector와 본문이 함께 비어 있는 상태다.
- 이번 라운드는 startup contract가 아니라 current-tree renderability를 본다. 선택된 tree가 실제 grid item과 rendered HTML을 모두 갖는지 먼저 확인한다.

## Review
- 증상상 current tree 선택은 존재하지만, 그 tree가 실제로는 그릴 수 없는 상태였다. 이 경우 selector value도 비고 본문도 비는 현상이 함께 나온다.
- `src/previewdef/focustree/selectionstate.ts`에 `resolveRenderableFocusTreeSelection()`을 추가했다. 기본 selection 복원 뒤, 그 tree가 렌더 불가능하면 첫 번째 renderable tree로 자동 보정하는 helper다.
- `webviewsrc/focustree.ts`의 `buildContent()`는 이제 현재 선택 tree의 layout plan과 rendered focus map을 함께 검사한다. 현재 tree가 실제 grid item과 focus HTML을 만들지 못하면, renderable tree로 선택을 보정하고 selector/UI 상태를 함께 새로 맞춘 뒤 렌더를 계속한다.
- `test/unit/focustree-selectionstate.test.ts`에는 renderable selection fallback 회귀 테스트 2개를 추가했다.

## Verification
- `npm run test:unit` passed with 136 tests.
- `npm run build` passed.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Real File Trace 2026-04-10

## Plan
- [x] 반복된 사용자 보정을 lessons/todo에 기록한다
- [x] 실제 문제 파일 `TFR_national_focus_KOR.txt`를 parser/layout 기준으로 추적한다
- [x] 실제 데이터에서 깨지는 경로를 고친다
- [x] compile, unit/UI 검증, VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재보정: "`TFR_national_focus_KOR.txt` 참조, 해결 아직 안됨"
- 이제 실제 문제 파일이 주어졌으므로 generic fallback 추측 대신 그 파일의 tree/condition/layout 결과를 직접 확인한다.

## Review
- 실파일 추적에서 `TFR_tree_KOR`는 focus가 626개인데도 현재 기본 상태에서 `gridItems: 0`으로 떨어지고 있었다. 같은 tree를 `hideDisallowedFocuses=false`로 계산하면 626개가 다시 보였으므로, 빈 캔버스의 직접 원인은 "조건을 하나도 고르지 않은 기본 상태에서도 `allow_branch` 기반 숨김 필터가 켜지는 것"으로 확인됐다.
- `webviewsrc/focustree.ts`의 조건 선택 복원 경로는 더 이상 "선택이 비어 있으면 사용 가능한 모든 조건을 자동 선택"하지 않는다. 대신 `src/previewdef/focustree/conditionselection.ts`의 `resolveSelectedConditionExprKeys()`를 통해, 사용자가 실제로 고른 조건만 복원하고 기본 상태는 빈 선택 그대로 유지한다.
- 같은 파일의 layout-plan 계산은 `useConditionInFocus && selectedExprs.length > 0`일 때만 `hideDisallowedFocuses`를 켠다. 따라서 `Conditions`가 비어 있는 초기 상태는 다시 `v0.13.20`처럼 전체 tree를 보여 주고, 사용자가 조건을 명시적으로 고른 뒤에만 `allow_branch` 필터가 적용된다.
- `test/unit/focustree-conditionselection.test.ts`를 추가해 빈 기본 선택, 저장된 조건 복원, clear 동작을 고정했고, 실파일 추적에서 드러난 "무선택 상태는 전체 표시" 계약을 코드 레벨로 분리했다.

## Verification
- `npm run test:unit` passed with 139 tests.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Offscreen Reveal Trace 2026-04-10

## Plan
- [x] 반복된 사용자 보정을 lessons/todo에 기록하고 selection-empty 이론에서 실제 viewport 위치 추적으로 전환한다
- [x] `TFR_national_focus_KOR.txt`의 렌더 결과가 비어 있는지, 아니면 오프스크린으로 밀려 있는지 계산한다
- [x] 실제 렌더된 포커스가 현재 뷰포트에 하나도 없을 때 앵커 포커스를 자동으로 보여 주도록 수정한다
- [x] compile, unit/UI 검증, VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재보정: "똑같은데"
- 실파일 계산 결과 현재 `TFR_tree_KOR`의 top-most focus는 존재하지만, `focusCreateSidePaddingColumns` / `focusCreateTopPaddingRows`와 음수 branch 좌표가 겹치면서 초기 viewport 밖으로 밀려 있었다.

## Review
- 실제 파일 추적에서 blank canvas의 원인은 "tree body가 0개"가 아니라 "초기 viewport에 렌더된 focus가 하나도 안 들어오는 것"이었다. `TFR_tree_KOR`는 `minX = -18`, `minY = 0`이고, 현재 build는 edit-mode blank canvas buffer 때문에 렌더 원점을 추가로 오른쪽/아래로 민다. 그 결과 top-most focus도 초기 viewport 바깥으로 밀려, 화면상으로는 비어 보였다.
- `webviewsrc/focustree.ts`에 `revealCurrentFocusTreeAnchorIfNeeded()`를 추가했다. full rebuild 뒤 현재 viewport 안에 보이는 focus element가 하나도 없으면, 선택된 focus를 우선하고 없으면 top-most/left-most focus를 앵커로 골라 `scrollIntoView()` 한다.
- 앵커 선택 규칙은 `src/previewdef/focustree/viewanchor.ts`로 분리했다. 현재 선택 focus가 있으면 그것을 우선하고, 없으면 `y`, `x`, `id` 순으로 정렬한 첫 focus를 반환한다.
- `test/unit/focustree-viewanchor.test.ts`를 추가해 selected-focus 우선, top-most fallback, 빈 position map 처리를 고정했다.

## Verification
- `npm run test:unit` passed with 142 tests.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Selected Tree Bootstrap Trace 2026-04-10

## Plan
- [x] 반복된 사용자 보정을 lessons/todo에 기록하고 viewport 이론에서 selected-tree 지정 경로 추적으로 전환한다
- [x] full HTML bootstrap과 webview 초기 state가 `selectedTreeId`를 어떻게 정하는지 확인한다
- [x] restored tree id가 없을 때 stale index 대신 host-selected tree를 우선하도록 수정한다
- [x] compile, unit/UI 검증, VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재보정: "그것보다는 focustree가 아예 지정이 안 되고 있는 것 같은데"
- 현재 focustree 주 경로는 patch message가 아니라 full HTML refresh인데, 이 bootstrap에는 `selectedTreeId`가 포함되지 않고 있었다.

## Review
- 실제로 현재 focus preview는 `focusTreeContentUpdated` patch 경로보다 `renderDocument()` 기반 full HTML refresh를 더 많이 타고 있었다. 그런데 이 full HTML bootstrap에는 `window.focusTrees`만 있고 `selectedTreeId`는 전혀 없어서, webview는 복원된 `selectedFocusTreeId`가 비어 있으면 오래된 `selectedFocusTreeIndex`만 믿고 current tree를 고르고 있었다.
- `TFR_national_focus_KOR.txt`처럼 첫 tree만 실제 focus를 가지고 뒤의 tree들이 비어 있는 파일에서는, stale index가 `3`이나 `4`로 남아 있으면 빈 tree가 현재 tree로 선택될 수 있었다. 사용자가 말한 "focustree가 아예 지정이 안 된다"는 증상과 정확히 맞는 경로다.
- `src/previewdef/focustree/contentbuilder.ts`는 이제 full HTML bootstrap에도 `window.bootstrapSelectedFocusTreeId`를 내려보낸다. 값은 host 기준 기본 tree인 `payload.focusTrees[0]?.id`다.
- `webviewsrc/focustree/state.ts`는 초기 state 구성 시 restored `selectedFocusTreeId`가 없으면 `window.bootstrapSelectedFocusTreeId`를 사용한다. 따라서 stale index만 남은 상태에서도 first real tree를 기준으로 selection이 다시 잡힌다.
- `test/unit/focustree-state.test.ts`를 추가해 "restored id가 없고 stale index만 있으면 bootstrap tree id를 쓴다"와 "restored id가 있으면 그것을 유지한다"를 고정했다.

## Verification
- `npm run test:unit` passed with 144 tests.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- 참고: `test-ui` 로그에는 fixture 기반 missing asset `UserError`와 VS Code mutex 경고가 계속 출력되지만, smoke assertions는 모두 통과했다.

# FocusTree Stable Build Path Restore 2026-04-11

## Plan
- [x] 반복된 사용자 보정을 lessons/todo에 기록하고, 추측성 선택/viewport 보정보다 안정 빌드 경로 복원으로 방향을 전환한다
- [x] focustree webview의 첫 build 경로를 v0.13.20 스타일로 되돌리되 이후 추가 기능은 유지되도록 접합한다
- [x] dispose race까지 같이 막고 필요한 회귀 테스트를 추가한다
- [x] compile, unit/UI 검증, VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재보정: "해결안됨..."이 반복됐다.
- v0.13.20 소스를 다시 대조해 보니, 현재 blank 재현은 tree id나 viewport만의 문제가 아니라 modern webview build 경로 전체를 더 의심해야 하는 단계다.

## Review
- `webviewsrc/focustree.ts`의 본문 build 경로를 `v0.13.20` 쪽 계산 방식으로 되돌렸다. 현재 tree의 grid item/position 계산을 다시 직접 수행하고, 조건 때문에 tree 전체가 비면 selection을 비우고 재계산하는 안정 경로를 복구했다. 그 위에 현재 기능인 preset, multi-select, grouped link/delete, continuous focus drag, viewport reveal은 그대로 유지되도록 현재 상태 동기화 코드를 접합했다.
- `src/previewdef/focustree/previewsession.ts`는 async full refresh가 dispose된 webview에 닿을 때 조용히 무시하도록 바꿨다. 이로써 `test-ui`에서 보이던 disposed rejection을 세션 레벨에서 삼키고, stale refresh가 새 panel 상태를 오염시키지 않게 했다.
- `test/unit/focustree-previewsession.test.ts`에는 disposed webview full refresh 회귀를 추가했다. 패키징 중에 참조 파일 `TFR_national_focus_KOR.txt`가 VSIX에 들어가는 문제도 `.vscodeignore`에 exact path를 넣어 정리했다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 145 tests.
- `npm run build` passed.
- `npm run test-ui` passed with 11 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.

# FocusTree Real File Repro Trace 2026-04-11

## Plan
- [x] `TFR_national_focus_KOR.txt` 기반 fixture와 smoke 경로를 추가한다
- [x] host/session/webview 진단 snapshot과 URI-scoped state restore를 구현한다
- [x] selected tree bootstrap을 첫 non-empty tree 우선 규칙으로 고정하고 icon 경로도 계측한다
- [x] compile, unit/UI 검증, VSIX packaging까지 다시 완료한다

## Notes
- 사용자 재지시: 세부 점검 계획을 실제로 구현하라고 요청했다.
- 이번 라운드는 추측성 fallback을 더 얹지 않고, 실파일 재현과 진단 값을 host까지 끌어와서 첫 렌더 입력을 검증하는 데 집중한다.

## Review
- `test/fixtures/workspace/common/national_focus/TFR_national_focus_KOR.txt`를 실제 smoke fixture로 추가했다. 이제 UI smoke가 단순 preset fixture가 아니라 사용자가 문제를 본 `TFR` 케이스를 직접 연다.
- `webviewsrc/focustree/state.ts`는 restored webview state를 현재 `window.previewedFileUri`와 비교해서, 다른 파일의 state이거나 `uri`가 없는 오래된 state면 tree/condition/search/edit-mode 복원을 버리도록 바꿨다. 이 경로에서 `selected tree`는 host bootstrap id를 우선하고, 그것도 비어 있으면 첫 non-empty tree로 고정한다.
- `src/previewdef/focustree/previewsession.ts`, `src/previewdef/previewmanager.ts`, `webviewsrc/focustree.ts`, `src/previewdef/focustree/index.ts`에는 session/webview diagnostics를 추가했다. focustree webview는 첫 load/build 때 현재 tree id, selector 값, focus grid item 수, rendered focus hit 수, canvas 크기를 host로 보내고, preview manager는 내부 debug command로 그 snapshot을 다시 읽을 수 있다.
- `src/previewdef/focustree/contentbuilder.ts`는 icon 경로에서 `resolved files hit`, `gfx scan hit`, `default fallback`, `unresolved gfx names`를 분리해서 기록한다. 이로써 icon이 안 뜨는 원인이 index miss인지 fallback scan miss인지 로그로 바로 구분된다.
- `test/unit/focustree-state.test.ts`는 stale index, 다른 파일 state, empty tree restore를 검증하도록 다시 썼고, `test/integration/extension.test.ts`는 새 internal debug command를 통해 `TFR_tree_KOR`가 실제 current tree로 잡히고 본문 grid/canvas가 비어 있지 않은지 확인한다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 147 tests.
- `npm run build` passed.
- `npm run test-ui` passed with 12 smoke tests, including the new `TFR_national_focus_KOR.txt` preview diagnostics assertion.

# FocusTree Selector Bootstrap Trace 2026-04-11

## Plan
- [x] selector option bootstrap 경로를 다시 점검하고 빈 selector 재현을 테스트로 고정한다
- [x] load 시 selector option을 강제로 재구성하고 diagnostics에 selector 상태를 포함한다
- [x] compile, unit/UI, package로 다시 검증한다

## Notes
- 사용자 재보정: "Focus Tree조차 인식되지 않는 것 같다."
- 최신 스크린샷은 selector label은 보이지만 option text가 비어 있으므로, current-tree 계산보다 selector option bootstrap 자체를 우선 본다.

# FocusTree Startup Filter And Create Responsiveness 2026-04-11

## Plan
- [x] startup 시 `allow_branch` filtering을 다시 표준 동작으로 되돌린다
- [x] 생성된 focus placeholder를 실제 카드처럼 보이게 조정한다
- [x] structural edit refresh를 ack 이후 비동기로 넘겨 체감 반응을 줄인다
- [x] compile, unit/UI, package로 다시 검증한다

## Notes
- 사용자 재보정: 시작 화면에서 `allow_branch`가 무시되고, 생성된 focus 표시가 어색하며, 프리뷰 반응이 느리다고 보고했다.

## Review
- 초기 렌더와 조건 UI가 서로 다른 규칙을 쓰고 있었다. `Conditions` 드롭다운은 빈 선택을 유지하지만, 실제 렌더는 tree별 기본 조건 또는 실제로 보이는 첫 조건을 사용해 `allow_branch`를 적용하도록 `webviewsrc/focustree.ts`를 정리했다. 이로써 시작 화면에서 모든 branch를 한꺼번에 노출하지 않으면서도 TFR처럼 빈 캔버스가 되던 케이스는 다시 막았다.
- 생성 직후 focus는 authoritative `renderedFocus`가 도착하기 전까지 깨진 중간 markup으로 바뀔 수 있었다. `webviewsrc/focustree.ts`에 tree별 pending placeholder 추적을 추가해서, host가 실제 HTML을 보낼 때까지는 local placeholder 카드를 계속 유지하게 했다.
- `src/previewdef/focustree/localpreview.ts`의 placeholder template은 임시 dashed box에서 실제 카드형 프레임으로 바꿨고, `src/previewdef/focustree/edithandler.ts`는 structural refresh를 optimistic ack 뒤 비동기로 넘겨서 생성/삭제/링크 편집 직후 체감 지연을 줄였다.
- `src/previewdef/focustree/conditionselection.ts`와 `webviewsrc/focustree.ts`는 `allow_branch` 적용 여부를 “UI에 선택이 보이느냐”가 아니라 “렌더에 실제 쓰인 조건이 있느냐” 기준으로 다시 맞췄다. 덕분에 stable contract와 현재 startup bootstrap이 충돌하지 않게 됐다.

## Verification
- `npm run compile-ts` passed.
- `npm run test:unit` passed with 149 tests.
- `npm run test-ui` passed with 13 smoke tests, including the TFR preview diagnostics checks.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- `.vscodeignore` was updated and `npm run package` rerun so stray root txt files are no longer included in the VSIX.

# FocusTree GXC Baseline Verification 2026-04-11

## Plan
- [x] `GXC focus (Liangguang).txt`를 focustree 실파일 기준 smoke로 연결한다
- [x] 기존 TFR 전용 integration assertion을 GXC 기준선에 맞게 정리한다
- [x] 테스트와 패키징을 다시 돌려 GXC 기준선으로 VSIX까지 검증한다

## Notes
- 사용자 기준 변경: "`GXC focus (Liangguang).txt` 를 기준으로 테스트"
- `vscode-test`의 workspace root는 저장소 루트가 아니라 `test/fixtures/workspace`라서, 기준 파일도 같은 workspace 안에 존재해야 integration smoke가 열린다.

## Review
- `test/integration/extension.test.ts`의 TFR 고정 smoke 둘을 GXC 기준 smoke로 교체했다. 이제 실제 기준 파일 `GXC focus (Liangguang).txt`를 열고, debug state에서 `currentFocusTreeId`, `selectedFocusTreeId`, selector text가 모두 `GXC_focus_tree`인지 확인한다. 본문 렌더까지 잡기 위해 focus count, grid item count, rendered focus hit count, canvas width/height도 같이 검증한다.
- 중복된 preview state polling은 `waitForFocusPreviewState()` 헬퍼로 정리했다. 같은 파일을 다시 열었을 때도 selector와 current tree 진단 값이 흔들리지 않는지 재오픈 smoke까지 포함했다.
- UI smoke가 처음 실패한 원인은 코드가 아니라 test workspace 경로였다. `vscode-test`는 `test/fixtures/workspace`를 workspace root로 사용하므로, 실제 기준 파일도 `test/fixtures/workspace/GXC focus (Liangguang).txt`로 복제해 smoke가 동일한 파일명을 가진 상태로 열리게 맞췄다.

## Verification
- `npm run build` passed.
- `npm run test:unit` passed with 149 tests.
- `npm run test-ui` passed with 13 smoke tests, including the new GXC-based focus preview checks.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.

# FocusTree Performance Recovery 2026-04-11

## Plan
- [x] focustree 초기 로드/문서 변경이 왜 느린지 현재 세션 경로를 점검한다
- [x] full HTML refresh 회귀를 제거하고 shell + snapshot update 경로로 되돌린다
- [x] 단위/UI 검증과 VSIX 패키징으로 성능 회귀 수정이 안전한지 확인한다

## Notes
- 사용자 재보정: 실제 핵심 문제는 blank 자체보다 로딩 속도와 편집 후 반응 속도가 현저히 느린 점이었다.

## Review
- 실제 병목은 focustree 세션이 이미 있는 snapshot/patch 인프라를 전혀 쓰지 않고, 초기 로드와 문서 변경마다 `webview.html` 전체를 다시 만드는 회귀 경로였다. 이 때문에 focustree 스크립트와 DOM이 매번 재부팅되고, 큰 트리에서는 첫 paint와 편집 후 반영이 모두 무겁게 느껴졌다.
- [previewsession.ts](C:\Users\Administrator\Documents\Code\hoi4modutilities\src\previewdef\focustree\previewsession.ts)는 이제 다시 `shell -> snapshot update` 흐름을 탄다. panel open 시에는 shell HTML만 즉시 넣고, 실제 tree 내용은 `focusTreeContentUpdated` 메시지로 전달한다. webview가 준비되기 전까지는 준비된 base state를 보관했다가, ready 이후에 그대로 적용한다.
- 첫 렌더는 `deferred` asset load로 보내고, ready 이후에 같은 document version에 대해서만 한 번 `full` hydration을 백그라운드로 예약한다. 그래서 본문은 먼저 뜨고, 무거운 icon/inlay asset 쪽은 뒤에서 보강된다.
- ready 이후의 일반 refresh와 구조 편집 후 refresh는 더 이상 HTML 전체 교체를 하지 않는다. render cache가 있으면 patch planner를 통해 partial/full content update를 보내고, webview는 현재 DOM을 유지한 채 필요한 부분만 갱신한다.
- [focustree-previewsession.test.ts](C:\Users\Administrator\Documents\Code\hoi4modutilities\test\unit\focustree-previewsession.test.ts)도 새 계약에 맞게 바꿨다. 핵심 회귀는 shell 유지, ready 이후 snapshot delivery, stale refresh discard, local/structural edit update, disposed postMessage 무시 경로다.

## Verification
- `npm run build` passed.
- `npm run test:unit` passed with 149 tests.
- `npm run test-ui` passed with 13 smoke tests.
- `npm run package` passed and refreshed `hoi4modutilities-1.0.0.vsix`.
- UI smoke 기준으로 GXC focus preview open은 약 `653ms`, reopen 안정화는 약 `700ms` 수준으로 통과했다.
