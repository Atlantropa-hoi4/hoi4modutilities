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

원시 JSON·프로파일 작업공간·editor user-data·캡처에는 사용자 홈 경로와
실제 모드 내용이 포함될 수 있다. 이 자료는 Git과 설치용 VSIX에 포함하지
않고 로컬에만 보관한다. 외부 공유 전에는 개인정보를 제거하고 실제 모드
원문·화면·이미지의 재배포 권한을 별도로 확인한다. 공개 저장소에는 요약
측정과 위의 재현 명령만 유지한다.

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

## 2026-10-11: 경량 색인과 표시 영역 우선 로딩

### 경량 색인 동등성

이번 경량 scanner는 전체 parser를 대체하지 않는다. 실제 TNO의 focus/GFX
764파일, 28,008,899 bytes에서 기존 parser/schema가 추출한 순서·중복을
그대로 비교했다. 760파일은 Rust/WASM이 처리했고, 4파일은 전체 parser로
돌렸다. 두 빈 파일은 같은 빈 결과였으며, `interface/TNO_fonts.gfx`
(65,21)와 `interface/load_screen_font.gfx` (69,21)는 기존 `< = { 8`
구문 오류도 그대로 보존했다. 지원하지 않는 파일에서 일부 이름만 성공한
색인으로 등록하지 않는다. 실제 production worker 경로의 14개 성공 표본과
두 parser 오류도 별도로 확인했다.

각 종류의 가장 큰 지원 파일 6개를 같은 Node 24.14.0 프로세스에서 예열하고
3회 반복했다. 아래는 파일별 중앙값을 합한 **직접 kernel wall time**이다.
파일 읽기·worker 초기화·대기열·왕복·웹뷰 렌더링은 포함하지 않는다.

| 실제 입력 6파일씩 | 기존 parser/schema | Rust/WASM scanner |
| --- | ---: | ---: |
| shared/joint focus IDs | 55.43ms | 13.49ms |
| GFX sprite names | 56.85ms | 16.74ms |

전체 미리보기 배속이나 OS CPU 절감율로 환산하지 않는다. shared-focus 색인은
local focus를 포함하지 않으며, unsupported aliases/variable blocks/attachment
syntax/unsafe numeric IDs 등은 기존 parser의 의미와 오류를 유지한다.
ABI v1의 선택적 `process_script_index` export가 없는 모듈도 같은 TS 경로를
사용한다. 파일 우선순위, `replace_path`, DLC 정책, 미저장 문서 및 색인
generation은 TypeScript에 남는다.

### 실행 계약

- 직접/상대 읽기는 12-slot FIFO priority pool을 공유한다. `interactive`
  요청은 대기 중인 같은 single-flight 읽기를 승격하고, background 색인은
  interactive admission 최대 3회 뒤에 실행 기회를 얻는다. 슬롯은 resolver
  재진입으로 이중 소비하지 않는다. `fileloader.read`의 `waitMs`, `resolveMs`,
  `contentMs`, `activeMs`로 대기와 실제 작업을 구분한다.
- 준비된 workspace shared-focus/GFX hit는 base-game/DLC 완료를 기다리지
  않는다. miss·미준비·무효화·비활성 상태를 완성된 결과로 취급하지 않으며,
  deferred shared-focus miss의 경고는 전체 레이어가 준비될 때까지 보류한다.
- root/dependency 편집은 하나의 serialized key에서 실행 중 1개와 최신
  pending 1개만 유지한다. 일반 문서 변경 35ms, Undo/Redo 0ms, disk 의존
  변경 150ms. stale generation/document/snapshot 또는 dispose된 결과는
  적용하지 않으며 의존성 무효화 범위를 합쳐 누락시키지 않는다.
- UI/UX 및 visible-first 구현은 설치된 Claude CLI의 `claude-design`
  작성자가 담당했다. 구조·카탈로그를 먼저 보존하고 화면 안→근처 순서로
  32개씩 요청한다. scroll/zoom/condition/branch 변경도 같은 경로를 사용한다.
- `sceneRendered`는 구조 화면의 paint 증거이며 자산 완료가 아니다.
  `sceneAssetsReady`는 트리 전환·재방문 epoch마다 실제 표시 아이콘의
  loaded CSS를 확인한다. 빈 임시 canvas, 회색 decode 실패, 미검사 아이콘을
  ready로 취급하지 않는다. 동일 트리의 condition 변경에는 새 tree-switch
  epoch를 요구하지 않고 실제 현재 viewport와 PNG를 다시 검사한다.

### 최종 코드의 실제 VS Code 전후 비교

이 비교의 이전 버전은 이번 총체적 개선 직전의 보관된 production 번들이다.
위 단계들의 baseline과 혼합하지 않는다. Windows x64, VS Code 1.141.0 /
Node 24.21.0, English, DLC off, production/auto Rust에서 양쪽 각 새 프로세스
3회로 광둥→슈크신 순서와 주석/x/y 편집·각 1회 Undo를 맞췄다. 최초 열기와
편집은 각 3표본, 재열기는 각 6표본의 중앙값이다.

| 시나리오 | 수정 전 | 최종 수정 후 | 단축 |
| --- | ---: | ---: | ---: |
| 광둥 최초 viewport 자산 적용 | 8,900ms | 6,782ms | 23.8% |
| 광둥 재열기 viewport 자산 적용 | 867ms | 665.5ms | 23.2% |
| 슈크신 첫 열기(광둥 뒤) | 1,062ms | 709ms | 33.2% |
| 슈크신 재열기 | 818ms | 623.5ms | 23.8% |
| 광둥 주석 편집 적용 | 139ms | 104ms | 25.2% |
| 광둥 주석 Undo | 109ms | 66ms | 39.4% |
| 광둥 imported shared focus x/y 편집 | 281ms | 134ms | 52.3% |
| 광둥 x/y Undo | 257ms | 88ms | 65.8% |
| 슈크신 주석 편집 적용 | 128ms | 77ms | 39.8% |
| 슈크신 주석 Undo | 93ms | 66ms | 29.0% |
| 슈크신 imported shared focus x/y 편집 | 235ms | 108ms | 54.0% |
| 슈크신 x/y Undo | 217ms | 61ms | 71.9% |

광둥 최초 완료 범위는 이전 8,660–9,284ms, 최종 6,778–6,911ms였다.
`visibleAssetsApplied`의 실제 적용 응답을 썼으며 polling 관측 지연과 구분한다.
최종 18번의 열기 모두 현재 viewport의 ready, 미렌더 0, unavailable 0을
확인했다. 편집은 정확한 문서 버전·새 snapshot·시작 뒤 적용 응답을 요구하고,
shared source 편집은 root 문서를 바꾸지 않는 dependency 응답으로 검사했다.
모든 cleanup에서 원문·disk bytes 복구 및 save event 0회를 확인했다.

**준비 범위는 같지 않다.** 이전은 선택 트리의 자산을 준비했고, 최종은
광둥 첫 화면의 3개/슈크신 4개 등 실제 viewport부터 준비한다. 카탈로그
19트리/827중점은 유지하지만 모든 트리의 모든 자산 완료 시간이 아니다.
OS 파일 캐시는 비우지 않았다. 슈크신 최초 열기는 이미 광둥 뒤의 예열
상태다. 표본이 작고 I/O·색인·UI 준비 범위를 함께 바꿨으므로 단축율을
Rust 단독 효과나 통계적으로 보장된 배속으로 주장하지 않는다.

### 실제 트리·편집·취소 smoke

- 새 VS Code 웹뷰에서 19개 트리를 순서대로 선택하고 각 렌더된 카드로
  스크롤했다. 표시된 PNG의 `Image.decode()`와 natural dimensions를
  3,802회 관찰했다(고유 이미지 수가 아니라 반복 관찰 수다).
- 4회 cached revisit에서 ID·좌표·title·source·icon key를 비교했고,
  5개 빠른 선택의 마지막 트리가 이기는지 검사했다. 준비가 끝난 네 번의
  재방문 모두 style element 4개, rules 1,591개, CSS text의 길이
  24,351,178 UTF-16 code units로 같았다. bytes 또는 전체 메모리 크기가 아니다.
- native zoom 버튼으로 100%→30%→100%를 실행하고 PNG를 검사했다.
  `angry_legco` 조건에서 추가 32중점의 reveal과 실제 PNG를 확인했다.
  조건 기능을 끈 새 preview에서는 branch checkbox가 36중점을 숨겼다가
  복구했고, 새로 드러난 카드의 PNG도 확인했다.
- root 주석 edit/Undo와 imported source x/y edit/Undo를 각 20회,
  총 80회 적용했다. DOM observer는 `(9,1)` 20회 및 원래 `(8,0)`
  초기 1회+Undo 20회를 기록했다. 12개 변경 burst 뒤 최신 버전 적용과
  원문 복구도 검사했다. 이후 19트리·4회 재방문에서 geometry/source가
  같고 실제 표시 아이콘이 유지됐다.
- 8회 preview open→즉시 미저장 변경→close→single Undo에서 dispose된
  debug state가 사라지고 원문이 정확히 복구됐다. 마지막 fresh reopen의
  source/좌표와 실제 PNG 3개를 확인했다. 최종 root/shared disk bytes는
  변하지 않았고 save event는 0회였다.

수정 전 endurance에서는 다른 트리의 화면 밖 focus가 같은 GFX 이름을
쓸 때 placeholder CSS가 기존 loaded 규칙을 덮는 회귀를 재현했다.
focus별 materialized ID는 남아 재요청도 없었다. 실제 shared source의
`GNG_the_four_companies`와 `GNG_ensure_corporate_interests_are_heard`가
동일 GFX를 사용하는 것을 확인했다. merge builder가 기존 rule keys를
참조해 placeholder만 생략하도록 수정했고, 준비 조건 완화·특수 focus 예외·
전체 자산 reload 없이 위의 동일 cached-revisit 시나리오가 통과했다.
실제 builder/cascade 및 session transition 회귀 테스트 2개도 추가했다.

| 같은 smoke host의 관측 시점 | heap used | RSS |
| --- | ---: | ---: |
| 초기 viewport | 400.9MiB | 707.2MiB |
| 전체 트리/재방문 뒤 | 469.4MiB | 763.2MiB |
| 취소/닫기 8회 뒤 | 871.3MiB | 1,220.4MiB |
| 마지막 fresh ready | 401.6MiB | 626.6MiB |

강제 GC나 retained-heap 분석을 하지 않았다. 색인·이미지 cache·검증 코드도
포함한 과정 관측이며, 마지막 회수는 영구 leak 없음/고정 RSS 보장이 아니다.
전체 트리 준비·반복 편집 중 일시적으로 1GiB 이상 RSS를 사용한다.

### 최종 검증·산출물·한계

- 최종 코드에서 `npm run verify`: Rust **54**, unit **1,137**, desktop
  integration **22** 통과. host/webview typecheck, production build, ESLint,
  local VSIX packaging을 포함한다.
- 측정에 사용한 extension SHA-256:
  `ec6cb4b083bad8b813bf354a663febd84e0ad8b970d69178c743fa92ec726436`.
  WASM 86,851 bytes / SHA-256:
  `147d63ebb9c290c0a2cb6a7eaeec1cdacc65bcb9c1eef10b0d1b0fbba6fa0d5a`.
  worker SHA-256:
  `fd6ca6618fb08bac2c229a6fda9abc8b20ce71af477cb2c8a64b499c5406ca0e`.
- cropped 실제 웹뷰도 확인했다. screen reader 낭독, 실제 실패/Retry 상태,
  한국어·러시아어·중국어 표시, reduced-motion 애니메이션은 별도 실제
  surface 측정하지 않았다. 번역/상태 경로는 타입·unit 검증에 포함된다.
- 기존 font GFX 문법·DDS magic 오류는 그대로 남는다. 일반 `.yml` 편집
  인덱스의 1000ms debounce와 완료 알림 없는 경쟁도 해결했다고 주장하지
  않는다. 비Windows·standalone Node 20·장시간 endurance는 미실측이다.
- 초기 구현/임시 하니스의 실패 기록은 보존했으나 최종 중앙값에 섞지
  않았다. VS Code toast의 native 클릭 차단은 알림을 닫아 해결했고,
  새 frame 식별은 변경되지 않는 Puppeteer name cache 대신 실제 iframe
  element로 확인했다. same-tree 조건 변경에 tree-switch marker를
  요구하던 임시 대기도 실제 viewport 검사로 교정했다.

재현은 위의 `profile-vscode-mod.mjs --samples 3 --edits` 명령을 사용하고,
이전 번들은 `--extension`으로 보관 root를 지정한다. 한 버전의 별도
launch 3회를 새로운 `--output` 경로로 실행한다. 모드·게임 파일에는
저장하지 않는다. 일회성 smoke 프로그램은 검증 뒤 제거했다.

## 2026-10-13: 추가 개선 8개와 검증 범위

이 절은 앞의 실제 TNO 결과와 별도다. 이번에는 실제 VS Code의 소유한 합성
workspace(130중점 트리와 1중점 트리), 현재 소스의 동작 smoke, 실제 캐시
snapshot을 사용했다. TNO 전체 프리뷰의 새 전후 프로파일은 수행하지 않았다.
앞 절의 미해결 목록 중 localisation commit 알림과 지도 in-flight 취소는
아래 변경으로 해결했고, 1000ms localisation debounce 자체는 유지한다.

### 적용한 계약

- localisation 변경 직후 per-file revision을 무효화하고, 최신 파일 결과가
  색인에 실제 공개된 뒤 URI/revision 알림으로 종속 preview를 다시 갱신한다.
  이전 parse가 다음 debounce 전에 늦게 끝나도 최신 편집을 덮지 않는다.
- 지도 generation diff는 matching completion까지 staging하고 한 번만
  공개한다. stale/중복 completion을 무시하고, generationless 편집은 이전
  공개 map의 alias를 바꾸지 않은 새 map으로 즉시 반영한다.
- 중점 검색은 DOM snapshot 대신 전체 표시 가능한 ID를 순회하며 target을
  mount한 뒤 이동한다. Enter/Shift+Enter, IME, Alt+Enter 소스 이동을 보존한다.
- 색인 readiness는 디스크 저장과 분리했다. 별도 제한된 worker가
  JSON/UTF-8/checksum을 처리하고, `unknown` cache 데이터는 색인별 shape
  guard를 통과해야 사용한다. null-prototype 실제 색인과 special keys를
  보존하며, v1 cache는 v2의 단일 JSON payload 형식으로 재구축한다.
- 중점 CSS는 base/version이 일치하는 delta만 적용하고, mismatch는 full
  resync한다. 모든 cached scene의 latest rule과 raw CSS를 보존한다.
  superseded CSSOM body를 비우고 dead-history 임계값에서 full 교체한다.
  교체 전 DOM text와 전체 scene/프로세스 메모리가 즉시 사라지는 것은 아니다.
- sprite는 `getFrame`으로 요청된 frame만 crop/PNG encode한다. encoded
  frame cache는 유지하고 decoded atlas scratch는 synchronous batch 뒤
  해제한다. 이후 미요청 frame은 atlas를 다시 decode할 수 있다.
- superseded 지도 요청은 consumer lease를 취소한다. 공유 flight는 모든
  consumer가 취소돼야 compute를 중단한다. TS fallback/zone/region 루프는
  `setImmediate`로 양보하고 abort를 검사한다. Rust zone 이식은 아니다.
- 실제 Claude CLI의 `claude-design` 작성자가 공용 dropdown/listbox
  키보드 동작, focus별 completion 이름, 경고의 focus/inert 전환을 구현했다.
  화면의 임의 재설계나 public ID/설정/버전/의존성 변경은 하지 않았다.

### 캐시 worker 실측

Node 24.14.0, `l_english` 129,541개, JSON 13,948,863 characters를
미리 읽은 뒤 3회 실행한 중앙값이다. 현재 built worker를 사용하며 파일 I/O와
색인 구축 시간은 제외한다. 입력 SHA-256:
`b28fa57ee2eec5a494d0b3e8fb155b6c3d21aa56b40c9019b2f15efa51e33a33`.

| 관측 | 이전 inline v1 경로 | 이번 bounded worker v2 경로 |
| --- | ---: | ---: |
| 호스트 첫 0ms timer 지연 | 146.85ms | 63.49ms |
| 직렬화 완료 wall time | 146.80ms | 215.46ms |
| 저장 bytes | 14,531,850 | 13,999,313 |

이전 시간은 직전 조사에서 기록한 같은 데이터의 메모리-only 경로이며,
이번 실행에서 옛 번들을 재측정한 값은 아니다. worker 제출의 동기 비용은
63.44ms였다. JSON/checksum은 off-thread지만 admission/structured clone은
여전히 호스트를 점유한다. 전체 저장 wall time이 더 빠르다는 주장은 하지
않는다. 실제 worker decode 결과는 입력 snapshot과 정확히 같았다.

### 실제 surface와 회귀 검증

- VS Code 1.141.0 / Node 24.21.0에서 native Enter로 130개 distinct ID를
  순회했고 Shift+Enter와 Alt+Enter 소스 line 이동을 확인했다. 지연 mount
  경계는 별도의 동작 회귀 테스트로 검증했다.
- 미저장 localisation의 이름이 자동으로 갱신됐고 한 번의 Undo로 원래
  이름이 돌아왔다. root 주석 편집도 한 번의 Undo로 정확히 복구했다.
- 소유한 PNG를 바꾸자 실제 표시 pixel과 396-character style delta가
  바뀌었다. 되돌린 뒤 live image rule은 하나였고, 이미 준비된 다른 트리
  선택에는 style CSS가 0 characters였다. fresh webview는 새 full base와
  원래 48px PNG를 받았다.
- native combobox 열기/선택/Escape와 multiselect Space 선택/해제를
  실행했다. nested checkbox의 Tab stop은 없었다. completion checkbox의
  focus별 이름과 Space 토글을 확인했다.
- 경고를 열면 entry로 focus가 들어가고 scene은 inert였다. Tab으로 가려진
  scene에 들어가지 않았고 Escape는 toggle로 focus를 돌렸다. 비탐색 경고는
  focus 가능한 DIV였고, 경고가 사라지는 automatic close는 refresh로
  focus를 복구했다. cropped 실제 웹뷰 PNG도 확인했다.
- 소유한 source/localisation 입력은 정확히 복구됐고 save event는 0회였다.
  첫 브라우저 세션은 명시적 finish 전 smoke watchdog으로 끝났으며, 관측한
  native 결과와 복구 기록을 보존했다. 별도의 최종 resync/surface 세션은
  명시적 finish, 원문/disk bytes 검사와 exit 0을 완료했다.
- 현재 소스의 지도 diff smoke는 interim publish 0회, matching completion
  1회, stale/중복 무시와 alias 보존을 검사했다. cooperative zone smoke는
  uniform/checkerboard/seam geometry·mass·순서 hash·경고 navigation을
  golden과 비교하고 event-loop 양보와 완료 전 abort를 실행했다.
- host/webview typecheck, production build, 전체 ESLint, Rust **54**,
  unit **1,198**, desktop integration **22**가 통과했다. 최초 aggregate의
  타입/fixture 계약 오류를 고친 뒤 관련 단계들을 실행한 결과이며,
  `npm run verify` 전체 명령이 성공했다고 표현하지 않는다.

실제 TNO 전체 map throughput, retained heap/장시간 endurance, screen reader
낭독, 한국어·러시아어·중국어 실제 화면, 비Windows와 Node 20 standalone은
이번에 새로 실측하지 않았다. worker의 host 비용과 atlas 재decode 비용도
남는다. 실게임/모드 파일을 저장하거나 커밋·게시·배포하지 않았다.
