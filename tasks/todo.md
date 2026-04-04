# HOI4 Mod Utilities Focus Preview Condition Presets Todo

## Plan
- [x] Inspect the current focus preview conditions flow, toolbar wiring, and host message surface
- [x] Add tree-scoped condition presets and saved condition selections for the focus preview
- [x] Add preset toolbar UI, host prompt/warning messages, and empty-state behavior
- [x] Add regression coverage for preset normalization and stale filtering
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and verification notes

## Notes
- Scope for this pass is the focus preview condition UX in `src/previewdef/focustree` and `webviewsrc/focustree.ts`.
- Keep the current `0.13.20` release line unless the user asks for a separate version.
- Presets are user-saved tree-local snapshots of `Conditions` selections only; they do not include completed-focus checks, inlay selection, or viewport state.

## Review
- Focus preview now supports tree-scoped saved condition presets with a `(Custom)` fallback state, save/delete icon actions, and host-driven preset naming via `showInputBox`.
- Condition selections are restored per focus tree, compared as normalized expr-key sets, and re-synced to the preset dropdown after manual condition edits or preview refreshes.
- Stale presets are filtered against currently available condition expressions; if a preset collapses to zero valid conditions, the preview keeps the empty selection and shows `No focuses match the current conditions.` instead of auto-resetting conditions.
- Added pure preset helper coverage in `test/unit/focustree-conditionpresets.test.ts` for normalization, stale filtering, and deletion behavior.
- Verification passed sequentially: `npm run compile-ts`, `npm run lint`, `npm test`, `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.20.vsix`.
- Manual VS Code preview smoke for preset save/apply/delete was not run in this terminal session.

## Follow-up Plan: Preset Runtime Smoke Replacement
- [x] Inspect the current focus preview/webview runtime surface and choose a VS Code integration-testable hook for preset actions
- [x] Add a minimal test-only focus preview runtime hook that can drive preset save/apply/delete and report resulting state
- [x] Add an integration test that opens a focus tree preview in VS Code runtime and verifies preset save/apply/delete through that hook
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run test-ui` if the environment allows it
- [x] Update review notes with what was verified in this terminal session and what remains environment-blocked

## Follow-up Review
- Replaced the previous manual-smoke gap with a runtime-testable path: `FocusTreePreview` can now round-trip test messages to the focustree webview and receive state snapshots for preset save/apply/delete assertions.
- Added `test/fixtures/workspace/common/national_focus/preset-smoke.txt` plus a new `test/integration/extension.test.ts` case that opens the focus preview in VS Code runtime, selects conditions, saves a preset, switches back to `(Custom)`, reapplies the preset, and deletes it.
- Verified successfully in this terminal session: `npm run compile-ts`, `npm run lint`, and `npm test`.
- `npm run test-ui` still could not complete in this terminal session because the downloaded VS Code binary failed to launch with `spawn EPERM` after `compile-ts` and `webpack` both succeeded. That is an environment execution restriction, not a failing assertion from the new preset smoke path.
