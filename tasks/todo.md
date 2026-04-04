# HOI4 Mod Utilities Focus Preview Status Badge Todo

## Plan
- [x] Inspect the current focus preview schema, render path, and regression surfaces for focus state badges
- [x] Add focus runtime metadata for availability, capitulation, ai, reward, and relation counts
- [x] Add compact badge/summary markup to rendered focus nodes
- [x] Evaluate and style badges in the webview without regressing existing interactions
- [x] Add regression coverage for badge metadata parsing and state evaluation
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and verification notes

## Notes
- Scope for this pass is focus preview status badges in `src/previewdef/focustree` and `webviewsrc/focustree.ts`.
- Keep the current `0.13.20` release line unless the user asks for a separate version.
- Badge v1 is the balanced scope: direct badges for availability, branch, capitulation, and relation counts; hover summary for `ai_will_do` and `completion_reward`.

## Review
- Focus runtime metadata now includes `available`, `availableIfCapitulated`, `hasAiWillDo`, `hasCompletionReward`, and prerequisite/exclusive counts for badge evaluation.
- Rendered focus nodes now ship badge and hover-summary placeholders, with compact pill styling injected into the existing focus template instead of a separate overlay system.
- The focustree webview now evaluates `Available`/`Blocked`, `Branch`, `Cap`, `P*`, and `X*` badges from the current toolbar condition set while keeping badge elements pointer-transparent so existing click, drag, link, and context-menu behavior is preserved.
- Added regression coverage in `test/unit/focustree-badges.test.ts` for schema metadata parsing and availability-state evaluation.
- Verification passed sequentially: `npm run compile-ts`, `npm run lint`, `npm test`, `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.20.vsix`.
- Manual VS Code preview smoke for badge rendering and hover summary was not run in this terminal session.
