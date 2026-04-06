# Focus Tree Large File Performance 2026-04-06

## Plan
- [x] Current focustree render path and large-file bottlenecks를 다시 확인하고 hot path를 특정한다
- [x] Host/webview 양쪽에서 병목을 줄이는 성능 패치를 구현하고 필요한 보조 테스트를 추가한다
- [x] 컴파일·관련 테스트·패키징으로 검증하고 결과를 정리한다

## Notes
- Current issue: large focus files still load too slowly in the Focus Tree preview.
- Root causes:
  - host-side payload generation still re-ran focus icon/image preparation for every focus, even when many focuses reused the same icon name
  - webview-side `setupCheckedFocuses()` scanned the full `conditionExprs` array for every rendered focus, creating avoidable `focus count x condition count` work on large trees

## Review
- `src/previewdef/focustree/contentbuilder.ts` now prepares icon render styles once per unique icon name before building `renderedFocus`, instead of re-fetching icon metadata for every focus node. The per-focus HTML render path is now synchronous string assembly over already-prepared styles.
- `webviewsrc/focustree.ts` now precomputes the set of `has_completed_focus` ids once per render via `src/previewdef/focustree/conditionexprs.ts`, so checkbox setup no longer performs a full `conditionExprs.some(...)` scan for every focus.
- Added focused regression coverage for the new completed-focus extraction helper so the large-tree checkbox optimization stays tied to the intended root-scope expressions only.

## Verification
- `npm run compile-ts` passed.
- `node .\\node_modules\\mocha\\bin\\mocha --exit out\\test\\unit\\focustree-conditionexprs.test.js out\\test\\unit\\focustree-inlay.test.js out\\test\\unit\\focustree-focusicongfx.test.js out\\test\\unit\\focustree-schema.test.js` passed with 12 tests.
- `npm run package` passed and produced `hoi4modutilities-0.13.22.vsix`.
