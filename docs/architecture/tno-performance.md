# TNO 실측 성능 개선 보고서

## 결과 요약

`tno-2nd-west-russian-war`(descriptor: **TNO Requiem 1.8.0c**)의 실제 파일과
VS Code 데스크톱 미리보기를 기준으로 개선했다. Rust 계산 코어만 바꾼 것이
아니라, 언어별 색인 범위·문서 캐시·이미지 처리·린트 경로를 함께 개선했다.

| 실제 VS Code 측정 | 이전 중앙값 | 최종 중앙값 | 해석 |
| --- | ---: | ---: | --- |
| 광둥 첫 열기: 자산 적용 완료 | 16.747초 | 10.179초 | **39.2% 단축**, 1.65배 |
| 광둥 첫 구조 화면 | 462ms | 429ms | 기존 빠른 구조 우선 표시 유지 |
| 광둥 재열기: 자산 적용 완료 | 2.440초 | 2.451초 | 유의한 개선 주장 없음 |
| 슈크신 첫 열기(색인 예열 후): 자산 적용 완료 | 1.697초 | 1.562초 | 작은 개선, 제한된 표본 |
| 슈크신 재열기: 자산 적용 완료 | 1.168초 | 1.196초 | 유의한 개선 주장 없음 |
| 지도 데이터 로더 | 4.324초 | 2.733초 | **36.8% 단축**; 최종 캔버스 paint 아님 |
| 지도 경계 처리 | 2.151초 | 0.677초 | 약 3.18배; 최종 경로는 검증도 포함 |

각 버전은 독립 저장소의 새 VS Code 프로세스 3회로 측정했다. 첫 열기 표본은
각 3개, 재열기는 프로세스당 2회로 각 6개다. 광둥 첫 열기 범위는 이전
16.484–21.615초, 최종 10.175–10.251초였다. 지도 로더는 이전
4.188–4.647초, 최종 2.699–2.781초였다. 중점 화면의 완료는 웹뷰의
`visibleAssetsApplied` 응답으로 판정했으며, 단순 파일 읽기 완료가 아니다.

### Rust 효과를 분리한 실제 래스터 CPU 검증

같은 프로세스에서 실제 5632×2048 BMP를 기존 TS 경로와 최종 프로덕션
어댑터로 처리한 3회 반복 중앙값이다. 복사·worker 왕복·결과 조립을 포함한다.

| 전체 province BMP 처리 | 중앙값 |
| --- | ---: |
| TS 색 추출 + TS zones/경계/검증 | 3456ms |
| Rust 색 추출만 + TS zones/경계/검증 | 3316ms |
| Rust 색 추출 + TS zones + Rust 경계/검증 | **854ms** |

전체 BMP 계산 경로는 **4.05배**, 75.3% 단축됐다. 색 추출만 옮겼을 때는
전체 병목이 거의 그대로였다. 최종 경계/검증 왕복은 603ms, 기존 결합
경계/검증은 3084ms였다. 다른 지도 로더와 브라우저 렌더링은 이 CPU 실험에
포함하지 않았다.

실제 299×299 raw DDS 아이콘 디코딩도 2.126ms TS → 0.707ms WASM 직접,
0.983ms worker 왕복으로 픽셀 동등성을 확인했다. 큰 raw DDS의 디코딩+PNG는
276.4ms → 235.8ms였고, PNG 인코딩이 여전히 상당한 비용을 차지한다.
이 수치를 전체 중점 미리보기 배속으로 환산하지 않았다.

## 변경 범위

- **Rust/WASM**: BC1/2/3·BGR에 더해 dense 8-bit RGB(A)와 지도 경계/검증을
  추가했다. 경계는 component·이웃·경로·경고 순서와 wrap/sentinel을 보존한다.
- **이미지**: 물리 이미지 요청 6개 이상인 bulk hydration에서 작은 DDS도
  기존 단일 bounded worker로 보낸다. 3개 decode 제한, coalescing, 입력/대기열
  상한은 유지하며, 한 장의 작은 이미지에는 기존 inline 정책을 유지한다.
- **색인**: vanilla/DLC localisation은 선택 언어+영어만 URI/stat 단계부터
  대상으로 삼는다. workspace는 모든 언어와 기존 fallback을 유지한다.
- **캐시**: 열린 문서 identity/version 토큰을 안정화하고, 초기 토큰을 읽기
  전에 캡처한다. GFX 로딩 중 세대 변경을 검사해 잘못된 새 토큰으로 이전
  데이터를 영구 캐시하지 않도록 했다.
- **린트**: 200ms debounce/최대 1초 대기, 128문서 current-version 결과 재사용,
  stale action·close/dispose 안전성과 한 번의 WorkspaceEdit을 유지한다.
- **폴백**: 선택적 Rust export 누락·정상 크기/할당 거절은 해당 작업만 TS로
  돌린다. 구 ABI 모듈로 아이콘마다 worker를 재시작하거나 다른 계산까지
  영구 비활성화하지 않는다. XRGB/XBGR의 기존 읽기 동작은 TS로 보존한다.

구현 계약과 자원 한계는 [Rust 아키텍처](rust-compute.md),
[crate ABI](../../rust/hoi4-compute/README.md)에 기록했다. VS Code API,
parser/schema, 파일 우선순위, 편집 및 웹뷰/캔버스는 TypeScript로 유지했다.
소스 파서 190파일 전체 sweep은 이 CPU 프로파일에서 262ms 수준이라,
이번 병목의 우선순위가 아니었다.

## 동등성과 검증

실제 BMP 입력은 34,603,062 bytes / 11,534,336 pixels다.
SHA-256: `5012065ca87833b4b5cf96ed20429d87f9501b6b11cbefa202414c4a0d557b47`.

TS·색상만 Rust·최종 Rust 경로의 **모든 province 필드, 경계 경로, 경고**를
순서 그대로 해시 비교했다. 16,406 색, 1,635,578 cover zones, 97,495
방향 경계, 1,260,130 경계 점에서 결과가 같았다. Graph+warnings SHA-256:
`a19c6040268d0eaf415a1d5e01764d2168588b99efc20548f84b8912f5c89399`.

실제 전체 지도 결과도 모든 실행에서 province 16,407 / state 2,031 /
country 520 / strategic region 266 / railway 1,460 / supply node 1,032 /
warning 65로 동일했다. 전체 지도 수는 정의/모델 기준이며 raw 색 수와
동일한 지표가 아니다. 모든 최종 지도 실행에서 `rust-wasm` 경계 backend를
확인했다. DDS RGBA·PNG는 원래 decoder 출력과 byte 단위로 비교했다.

최종 코드의 `npm run verify` 통과:
- native Rust **50개**, unit **1044개**, 실제 desktop VS Code integration **22개**
- extension/webview 타입 검사, production build, ESLint, VSIX packaging
- `cargo fmt --check`, profiling script syntax, `git diff --check` 통과

WASM은 48,201 bytes이며 SHA-256은
`7e9ea8a8f18ba467229adaa4f3159e112cc0c89f1d8795f45a2b728d5f4035a8`이다.
Worker SHA-256은
`68767d0889b65f21d2a72f4ea2f1a62f84ddc72a98e0312bb1daa5f7d957a5b8`이다.
이 값은 실제 desktop·CPU 측정에 사용한 최종 산출물과 같다.

## 측정 조건과 한계

Windows x64, Ryzen 7 7700X / 약 32GiB RAM, Rust 1.95.0,
VS Code 1.141.0의 Node 24.21.0, CPU profiler의 Node 24.14.0.
같은 Steam 게임 build 25205862, English preview localisation, DLC 로딩 off,
`NODE_ENV=production`, backend auto를 사용했다. 입력 모드·게임은 읽기 전용이며
설정/보고서는 격리된 프로젝트 출력에만 썼다. 이전 버전은 이미 BCn/BGR
Rust를 포함한 phase-1 VSIX 보관본이다. 따라서 이 표는 추가 개선의 효과다.

- OS 파일 캐시는 flush하지 않았다. fresh launch는 확장 저장소/프로세스
  기준이지 물리 디스크 cold boot가 아니다. 표본이 작아 통계적 보장은 없다.
- 지도 이전 debug 명령은 매 poll마다 약 90MB JSON을 다시 직렬화했다.
  최종은 크기를 memoize하고, 계측 중 이를 생략한 뒤 종료 후 1회 측정한다.
  따라서 observed-ready **8.339→5.139초**, event-loop max 중앙값
  **2.196→0.266초**, 지도 heap 수치는 **Rust 단독 효과나 동일 계측의
  사용자 paint 개선으로 주장하지 않는다**. 로더 타이머는 retained-map
  직렬화 전에 종료된다. 동일한 구 계측을 썼던 예비 실행에서도
  event-loop max 2.368→0.506초를 관찰했다.
- 최종 `dataCommittedAt` 약 5.1–5.3초는 웹뷰 데이터 응답 완료이며 최종
  canvas paint/실제 상호작용 시간을 측정한 것이 아니다.
- 자동 GC 때문에 heap 범위가 크게 겹친다. 광둥 최초 heap 관측은 이전
  738–826MiB, 최종 476–836MiB로, median은 낮지만 retained-memory/RSS
  보장이나 전반 메모리 절감율로 제시하지 않았다.
- 기존 font GFX 문법/일부 DDS magic/없는 dummy country 파일 오류는 양쪽에서
  발생했다. 일치하는 로더 결과와 경계 동등성이 모든 모드 자산의 호환성
  인증을 뜻하지는 않는다. localisation CPU 표본은 24파일/32.4MB이지 전체
  TNO localisation이 아니다. Korean 전환은 회귀 테스트로 검증했으나 별도
  Korean end-to-end 속도 수치는 없다.
- 다른 preview 가족, 비Windows, Node 20 standalone, 장시간 연속 편집,
  final canvas paint는 별도 실측하지 않았다. 문서 cache의 200ms window,
  세대 알림 없는 디스크 의존 race, 공유 map 작업의 in-flight 취소는 남는다.
- 기존 사용자 focus geometry/routing 변경과 성능 문서는 수정하지 않았고,
  게임/모드 변경·커밋·게시·배포는 하지 않았다.

## 재현 및 원시 기록

[데스크톱 측정기](../../scripts/profile-vscode-mod.mjs),
[test entry](../../test/performance/realmod.ts),
[bounded CPU 측정기](../../scripts/profile-mod.mjs)를 사용한다.

```powershell
node scripts/profile-vscode-mod.mjs --mod "<mod directory>" --game "<game directory>" --focus common/national_focus/TNO_Guangdong.txt --focus common/national_focus/2WRW_Shukshin.txt --samples 3 --worldmap --version 1.141.0 --test-entry out/test/performance/realmod.js --output .vscode-test/performance/new-run.json
node --expose-gc scripts/profile-mod.mjs --mod "<mod directory>" --samples 3 --warmups 1 --max-seconds 300 --output prod/performance/new-cpu-run.json
```

최초 entry는 `npm run compile-tests`로 생성한다. 데스크톱 측정기의
`--extension`은 보관된 이전 확장 root를 지정하며, `--backend typescript`,
`--language Korean`으로 별도 제어 실험을 할 수 있다. 출력은 새 경로여야
하며 모드/게임 안에 쓸 수 없다. profiler가 상속된 `ELECTRON_RUN_AS_NODE`를
제거해 실제 VS Code 앱으로 실행한다.

로컬 원시 기록(설치용 VSIX에 포함하지 않음):
- [이전 1](../../.vscode-test/performance/tno-vscode-baseline-production-1.json),
  [이전 2](../../.vscode-test/performance/tno-vscode-baseline-production-2.json),
  [이전 3](../../.vscode-test/performance/tno-vscode-baseline-production-3.json)
- [최종 2](../../.vscode-test/performance/tno-vscode-final-production-2.json),
  [최종 3](../../.vscode-test/performance/tno-vscode-final-production-3.json),
  [최종 4](../../.vscode-test/performance/tno-vscode-final-production-4.json)
- [실제 입력 CPU/동등성 기록](../../prod/performance/tno-optimized.json)

각 JSON은 입력/산출물 해시, 메모리·이벤트 루프 관측, 세부 stage와 실제
backend를 보관한다. 예비 old-debug 비교는 요약 표의 최종 데이터와 섞지 않았다.

## 2026-10-11: 중점 프리뷰·에디터 추가 개선

위의 dsh 결과를 출발점으로 삼아, 기존 Rust/WASM DDS·지도 처리 경로를
유지하고 중점의 자산 준비 범위와 Windows 비동기 양보 비용을 줄였다.
아래 비교의 이전 버전은 이번 수정 직전의 프로덕션 번들이다. 위 표의
phase-1 이전 버전과 혼합하지 않는다.

### 변경 경로

- `src/previewdef/focustree/loader.ts`, `loaderadapter.ts`, `snapshotbuilder.ts`,
  `contentbuilder.ts`: 전체 중점 카탈로그·소스 범위를 유지하되, 첫 자산
  로딩은 선택된 트리의 아이콘·GUI 카드 템플릿·inlay로 제한한다.
- `previewsession.ts`, `renderpayloadpatch.ts`: 기존 scene request/merge로 다른
  트리를 로딩한다. 이미 로딩한 트리도 편집·자산 무효화 시 함께 갱신해,
  웹뷰 내부 재방문에 오래된 아이콘·템플릿이 남지 않게 한다.
- 로더 어댑터는 scope마다 전체 소스 그래프를 복제하는 Map 대신 구조 상태와
  가장 최근 자산 상태 하나를 보관한다. 의존성 목록은 로딩된 트리들의
  합집합을 유지하며, 해당 범위를 모두 갱신한 뒤 불필요한 경로를 교체한다.
- `rendercancellation.ts`, `src/util/loader/loader.ts`: `setTimeout(0)`을
  `setImmediate`로 교체한다. 호스트 이벤트 양보·취소 검사·세대 검사는
  유지한다. 별도 100회 양보 측정은 timer 1,554.154ms,
  immediate 0.427ms였으며, 이를 사용자 체감 속도 수치로 대신하지 않는다.
- `scripts/profile-vscode-mod.mjs`, `test/performance/realmod.ts`: 선택적
  `--edits` 측정으로 미저장 주석 추가, 실제 source 중점 x/y 편집, 각 1회
  Undo를 실행하고 정확한 웹뷰 적용 응답 및 원문·디스크 보존을 검사한다.

### 실제 VS Code 전후 비교

Windows x64, VS Code 1.141.0 / Node 24.21.0, English, DLC off,
프로덕션 번들, Rust backend auto. 양쪽 모두 독립 확장 저장소의 새 프로세스
3회에서 광둥과 슈크신을 같은 순서로 열었다. 최초 열기는 각 3개 표본,
재열기는 프로세스당 2회로 각 6개 표본이다. 편집은 각 프로세스의 마지막
재열기에서 실행했으므로 시나리오별 3개 표본이다. 값은 중앙값이다.

| 시나리오 | 수정 전 | 수정 후 | 단축 |
| --- | ---: | ---: | ---: |
| 광둥 최초 자산 적용 완료 | 10,663ms | 7,314ms | 31.4% |
| 광둥 재열기 자산 적용 완료 | 2,549.5ms | 682ms | 73.2% |
| 슈크신 최초 자산 적용 완료(광둥 뒤) | 1,682ms | 931ms | 44.6% |
| 슈크신 재열기 자산 적용 완료 | 1,222ms | 658.5ms | 46.1% |
| 광둥 주석 편집 적용 | 256ms | 141ms | 44.9% |
| 광둥 주석 Undo 적용 | 212ms | 108ms | 49.1% |
| 광둥 shared focus x/y 편집 적용 | 384ms | 245ms | 36.2% |
| 광둥 x/y Undo 적용 | 307ms | 235ms | 23.5% |
| 슈크신 주석 편집 적용 | 171ms | 124ms | 27.5% |
| 슈크신 주석 Undo 적용 | 134ms | 95ms | 29.1% |
| 슈크신 shared focus x/y 편집 적용 | 263ms | 217ms | 17.5% |
| 슈크신 x/y Undo 적용 | 233ms | 203ms | 12.9% |
| 광둥 최초 중점이 있는 구조 화면 | 482ms | 499ms | 개선 주장 없음 |
| 슈크신 최초 중점이 있는 구조 화면 | 256ms | 208ms | 18.8% |

광둥 최초 자산 완료 범위는 이전 10,600–10,785ms, 이후
7,197–7,386ms였다. 재열기는 이전 2,464–2,598ms, 이후 632–769ms였다.
광둥의 전체 19개 트리/827개 중점은 유지하면서 최초 자산 준비는
선택된 트리의 68개 중점에 한정한다. 조건으로 숨겨진 중점을 제외한
실제 첫 화면에는 36개가 표시된다.

자산 완료는 `visibleAssetsApplied` 응답으로 판정한다. 최초 구조 화면은
중점이 실제 존재하는 적용 응답을 사용하며 빈 shell paint를 제외한다.
편집 완료는 시작 이후의 새 적용 응답, 정확한 preview 문서 버전,
이전보다 높은 snapshot 버전으로 판정한다. imported shared focus 편집은
root 문서를 수정하지 않으며 `source=dependency` 응답도 요구한다.
소스 문서 버전은 별도로 확인한다.

### 검증 및 한계

- 두 입력 root 파일의 해시는 전후 동일하다. 편집·Undo마다 변경 범위,
  정확한 원문 복구, save event 0회, root·shared source 디스크 bytes 보존을
  검사했으며 6개 보고서의 모든 결과가 성공했다.
- extension/webview typecheck, 프로덕션 build, ESLint, unit **1,056개**,
  desktop integration **22개**를 통과했다.
- 실제 VS Code 웹뷰에서 Suzuki → Yasuda → Suzuki → Yasuda → Suzuki를
  실행했다. 19개 선택지, 각각 36/47개 표시 중점, 모든 표시 아이콘의 실제
  PNG background, 재방문의 중점 ID·좌표·아이콘 일치를 확인했다.
  호스트 `sceneHydrated`는 Yasuda의 47개 중점만 준비했다고 기록했으며,
  마지막 선택과 미저장 변경 없음도 확인했다.
- OS 파일 캐시는 비우지 않았다. 슈크신 최초 열기는 광둥 뒤의 예열 상태다.
  새 저장소/프로세스 기준 최초 열기이며 디스크 cold boot가 아니다.
- 선택하지 않은 트리의 자산 준비는 첫 전환 시점으로 이동한다. 따라서
  전체 19개 트리의 모든 자산이 7.314초에 준비된다는 주장이 아니다.
  모든 트리의 첫 전환 지연이나 장시간 연속 편집·메모리 안정성은 측정하지
  않았다. 광둥 구조 화면은 유의한 개선으로 주장하지 않는다.
- 이 추가 비교에서 Rust/WASM과 compute worker의 SHA-256은 전후 동일하다.
  이번 단축을 신규 Rust 계산의 효과로 주장하지 않는다. 추가 지도 개선,
  다른 모드·preview, 비Windows, standalone Node 20 속도는 측정하지 않았다.
- 기존 TNO font GFX 문법·DDS 등 자산 오류는 남는다. 이번 변경은 이 오류를
  무시하거나 호환성으로 포장하지 않는다.

재현 명령:

```powershell
npm run compile-tests
node scripts/profile-vscode-mod.mjs --mod "<mod directory>" --game "<game directory>" --focus common/national_focus/TNO_Guangdong.txt --focus common/national_focus/2WRW_Shukshin.txt --samples 3 --edits --version 1.141.0 --output .vscode-test/performance/focus-edits-new.json
```

동일 측정기의 `--extension "<preserved extension directory>"`으로 이전 번들을
실행할 수 있다. 출력은 새 경로여야 하며 모드·게임 안에 쓸 수 없다.
새 `--edits` 경로도 게임·모드 파일에 저장하지 않는다.

로컬 원시 기록(설치용 VSIX에 포함하지 않음):
- [이전 1](../../.vscode-test/performance/omp-focus-edits-before-1.json),
  [이전 2](../../.vscode-test/performance/omp-focus-edits-before-2.json),
  [이전 3](../../.vscode-test/performance/omp-focus-edits-before-3.json)
- [이후 1](../../.vscode-test/performance/omp-focus-edits-after-1.json),
  [이후 2](../../.vscode-test/performance/omp-focus-edits-after-2.json),
  [이후 3](../../.vscode-test/performance/omp-focus-edits-after-3.json)
- [실제 scene 전환 결과](../../.vscode-test/performance/scene-smoke-session/done.json)
