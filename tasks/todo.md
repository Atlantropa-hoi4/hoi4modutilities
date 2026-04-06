# Focus Preview Reopen Load Retention Fix 2026-04-06

## Plan
- [x] Confirm why the preview pays a full bootstrap cost on every reopen/reveal
- [x] Keep preview webview context alive while hidden so reopening the same preview avoids a full reload
- [x] Run focused verification and record what was proven versus environment-blocked

## Notes
- `src/previewdef/worldmap/worldmapcontainer.ts` already opts into `retainContextWhenHidden`, but the generic preview path in `src/previewdef/previewmanager.ts` does not.
- That mismatch matches the reported behavior: standard previews lose their in-memory webview state while hidden, then rebuild from scratch when revealed again.

## Review
- Root cause was the generic preview panel in `src/previewdef/previewmanager.ts` being created without `retainContextWhenHidden`, unlike the world map preview.
- `src/previewdef/previewmanager.ts` now enables `retainContextWhenHidden` for standard HOI4 preview panels, so hiding and revealing an already-open preview keeps its live webview state instead of forcing a full bootstrap.
- Updated `tasks/lessons.md` with the reopen-performance pattern so future preview-slow reports check panel retention before deeper rendering changes.
- Verification:
  - `npm run compile-ts` passed.
  - `npm run package` passed and produced `hoi4modutilities-0.13.21.vsix`.
  - I did not rerun `npm run test-ui` for this tiny panel-option change; the last local UI runs in this repo are still environment-blocked at `@vscode/test-electron` `spawn EPERM`.
