# HOI4 Mod Utilities Focus Layout Editor Drag Start Fix Todo

## Plan
- [x] Inspect the current drag-start path, DOM hit targets, and any overlay or pointer-event blockers in the focus preview webview
- [x] Implement the smallest reliable fix so `Edit` mode actually starts a drag and still auto-applies on mouseup
- [x] Verify the fix, update task notes, and capture the lesson from this root-cause pass

## Notes
- The minimal `Edit`-only UI is still the desired end state, but the user reports that dragging still does not work at all in practice.
- This pass should not broaden the feature again; it should identify exactly why mouse interaction fails to start or complete a drag.
- Likely root-cause areas are event binding location, hit-testing against nested focus DOM, or preview layers blocking pointer events.

## Review
- Root cause was the fullscreen `#dragger` pan layer used by zoom/scroll support. In edit mode it was still eligible to receive pointer input, so focus nodes could fail to receive the drag-start interaction.
- The fix keeps the minimal `Edit` UI intact and disables the pan layer's pointer interlock only while layout edit mode is enabled.
- Focus dragging still auto-applies on mouseup; this pass only changed the interaction surface so drag-start can reliably reach the selected focus node.
- Verified with `npm test` and `npm run package`; the packaged output is `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.8.vsix`.
- `npm run test-ui` was not rerun in this pass.
