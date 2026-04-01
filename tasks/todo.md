# HOI4 Mod Utilities Localisation Runtime Regression Todo

## Plan
- [x] Attempt to capture the extension-host error path behind `FAILED to handle event` after `onLanguage:plaintext` activation
- [x] Patch the localisation-highlighting event flow so non-localisation editors cannot throw during refresh
- [x] Add or extend regression coverage for the failing parsing/event edge case where practical
- [x] Verify with `npm run compile-ts`, `npm run lint`, and `npm test`

## Notes
- The regression was reported from VS Code Runtime Status after the localisation-highlighting feature landed.
- Prioritize root-cause diagnosis from logs before changing behavior.
- Keep the fix minimal and defensive; avoid widening the localisation feature scope during the bugfix.

## Review
- Implemented:
  - reset the task ledger for the localisation runtime regression and recorded a project lesson to wrap extension-host event handlers defensively
  - added an error boundary around localisation highlighting refresh so per-editor decoration failures are logged and reported instead of bubbling up as unhandled event failures
  - kept the fix scoped to the localisation-highlighting event flow without changing preview/index behavior
- Verification:
  - `npm run compile-ts`: passed
  - `npm run lint`: passed
  - `npm test`: passed
  - `npm run test-ui`: blocked by environment-level `spawn EPERM` when launching downloaded VS Code host
- Notes:
  - direct inspection of `%APPDATA%\\Code\\logs` was blocked by sandbox access restrictions in this environment, so the runtime stack could not be collected locally
  - the defensive boundary ensures future highlighting exceptions are captured in the extension output/telemetry path rather than surfacing as `FAILED to handle event`
