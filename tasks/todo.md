# HOI4 Mod Utilities Focus Layout Pan And Drag Recovery Todo

## Plan
- [x] Inspect the current pan-layer and edit-mode interlock to identify why both normal pan and edit drag are unavailable
- [x] Implement the smallest fix that restores normal preview pan outside `Edit` mode and direct focus drag inside `Edit` mode
- [x] Verify the recovery, update task notes, and capture the lesson from this regression

## Notes
- The latest regression report is worse than before: `Edit` mode still does not drag focuses, and normal preview panning is now broken too.
- This pass should focus on the interaction interlock itself, not on expanding the editor UI.
- The likely issue is that the pan-layer and edit drag logic are now disabling each other instead of handing off correctly.

## Review
- Root cause was a bad intermediate interlock in the webview: normal preview pan had effectively been left disabled all the time, while `Edit` mode drag still looked up the first matching layout key instead of using the actual clicked target.
- Normal mode now uses the original preview pan path again, and `Edit` mode disables that pan path only while editing or auto-applying.
- Focus drag now resolves the clicked layout target from the actual pointer hit and drags that element directly instead of querying the first matching layout key in the DOM.
- Verified with `npm test` and `npm run package`; the packaged output is `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.8.vsix`.
- `npm run test-ui` was not rerun in this pass.
