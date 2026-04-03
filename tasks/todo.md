# HOI4 Mod Utilities Focus Preview Offset Drag Expansion Todo

## Plan
- [x] Inspect the current focus layout edit pipeline and identify the minimum schema and webview changes needed for offset drag targets
- [x] Implement visible offset drag handles and route drag updates to the matching offset draft without regressing base focus drag or preview pan
- [x] Add or extend unit tests for offset-target editing behavior and text patch generation
- [x] Run compile, lint, tests, and package, then record the review notes and any remaining manual verification gaps

## Notes
- This pass extends the existing focus layout editor instead of redesigning it.
- Base focus drag, continuous focus drag, and inlay drag should keep their current semantics.
- Offset editing is limited to currently visible active offsets and should still apply immediately on drag end.

## Review
- Active focus `offset` blocks now receive their own layout target keys and inline `O` drag handles in edit mode, so offset dragging stays separate from base focus dragging while reusing the existing mouse-up apply flow.
- Offset drag state now goes through a shared helper that resolves the matching offset draft by edit key and applies the same grid-based drag math as base focus positions.
- Focus-tree schema metadata now propagates offset edit keys onto rendered offsets so the webview can target the exact visible offset block that the text edit service patches.
- Added unit coverage for offset-draft lookup and drag math, plus an offset-only text patch test to ensure unrelated focus, continuous-focus, and inlay fields stay unchanged.
- Verified with `npm test` and `npm run package`; the packaged VSIX is `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.8.vsix`.
- A true manual VS Code smoke pass for pan/edit interaction was not run in this environment.
