# HOI4 Mod Utilities Focus Layout Editor Todo

## Plan
- [x] Add the experimental `focusLayoutEditor` feature flag and collect active-file-only layout edit metadata from focus-tree parsing
- [x] Implement token-based layout patch generation and guarded Apply/Discard/Reload handling for the focus preview
- [x] Extend the focus-tree webview with edit mode, drag support, and inspector-driven draft editing
- [x] Add regression coverage for patch generation and preview behavior, then run verification

## Notes
- Scope is intentionally limited to the active preview document.
- Editable fields in v1: focus `x/y`, `relative_position_id`, `offset[].x/y`, `continuous_focus_position.x/y`, and focus-tree `inlay_window.position.x/y`.
- Shared/joint focuses and inlay definitions from other files stay read-only even if rendered in the preview.
- Apply must be explicit and blocked when the source document version has changed since the draft was created.

## Review
- Added the `focusLayoutEditor` feature flag, active-file layout metadata, and a token-based patch service for focus coordinates, relative positioning, offsets, continuous focus placement, and inlay reference placement.
- Wired the focus preview panel to hold explicit layout drafts, reject stale applies, and support Apply/Discard/Reload messaging without changing existing preview/navigation commands.
- Extended the focus-tree webview with an opt-in edit mode, selection/dragging for editable layout targets, and an inspector for numeric edits, `relative_position_id`, offset add/remove, and source navigation for read-only targets.
- Added regression coverage in `test/unit/focustree-layoutedit.test.ts` plus `test/fixtures/focus/layout-edit.txt` for patch generation.
- Verification:
  - `npm test` passed.
  - `npm run package` passed and produced `hoi4modutilities-0.13.7.vsix`.
  - `npm run test-ui` is still blocked in this environment by `spawn EPERM` when launching the downloaded VS Code host.
