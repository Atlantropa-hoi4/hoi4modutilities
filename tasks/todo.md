# HOI4 Mod Utilities UI Test CI Fix Todo

## Plan
- [x] Confirm the real `test-ui` CI failure from the user-provided GitHub Actions log
- [x] Update the UI-test build path so fresh checkouts produce the extension bundle before launching `vscode-test`
- [x] Document the fix rationale and capture the user-correction lesson
- [x] Run focused verification for compile/bundle steps and record any remaining local environment limits

## Notes
- The GitHub Actions failure is in `npm run test-ui`, not `test:unit`.
- The actual activation failure is `Cannot find module '...\\dist\\extension.js'`, which then causes missing-command and timeout follow-on failures.
- `compile-ts` only creates the `out/` test artifacts; the extension manifest points `main` at `dist/extension.js`, so UI tests need a webpack build as well.

## Review
- Updated `package.json` so `npm run test-ui` now runs `compile-ts`, then `webpack`, then `vscode-test`. This ensures fresh checkouts build `dist/extension.js` and `static/*` before the VS Code integration harness loads the development extension.
- Updated `src/extension.ts` to keep the dev-only `server.hoi4modutilities.test` command registered without requiring the missing `./util/debug.shouldignore` module. The command now surfaces a simple informational message instead of crashing webpack resolution.
- Updated `test/integration/extension.test.ts` so the event-preview smoke test no longer relies only on `TabInputWebview instanceof` and a short 15s window. It now accepts the stable `HOI4: ...` tab title fallback and waits up to 30s, which better matches what the CI log showed: preview telemetry and loader work had already started before the tab assertion timed out.
- Added a lesson to `tasks/lessons.md` capturing the user correction pattern: when the CI log explicitly says `dist/extension.js` is missing, fix the build path first instead of chasing downstream command/time-out symptoms.
- Focused verification passed: `npm run compile-ts`, `npm run webpack`, and `npm run test:unit`.
- `npm run test-ui` now gets past the original missing-bundle failure, downloads VS Code, and only then stops on the known local environment issue `spawn EPERM` in this terminal. In other words, the prior `dist/extension.js` activation failure from GitHub Actions is no longer reproduced in this session, but the updated event-preview smoke assertion still needs a real CI rerun for end-to-end confirmation.
- Remote GitHub Actions still needs one rerun for end-to-end confirmation in the actual CI environment.
