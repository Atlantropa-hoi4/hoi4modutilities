# HOI4 Mod Utilities Focus Preview Large-Tree Navigation Todo

## Plan
- [x] Inspect the current search, zoom, scroll, and selection restore paths for large-tree navigation
- [x] Add a right-side minimap shell with collapse state and compact jump actions
- [x] Add tested minimap geometry helpers for bounds, viewport, and scroll-target conversion
- [x] Wire minimap rendering, click jump, drag move, and hover tooltip in the focustree webview
- [x] Reflect selected, searched, and last-navigated focuses in minimap state without regressing edit-mode interactions
- [x] Add regression coverage for minimap geometry and state projection
- [x] Update changelog notes for the same `0.13.20` release line
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review results and verification notes

## Notes
- Scope for this pass is large-tree navigation only in the focus preview; parser/schema/writeback behavior stays unchanged.
- The primary v1 navigation surface is a fixed minimap on the right, plus `Jump to selected` and `Jump to continuous` actions.
- Minimap interaction must stay separate from blank-canvas pan, drag edit, marquee select, and context-menu hit targets.

## Review
- Added a fixed right-side focus minimap shell with collapse state, viewport rectangle, hover tooltip, and quick jumps to the selected or continuous focus region.
- Added pure minimap helper calculations in `src/previewdef/focustree/focusminimap.ts` so focus-point projection, viewport mapping, and click-to-scroll behavior are testable outside the webview.
- The focustree webview now rebuilds minimap points only after content renders, then keeps viewport and highlight state in sync across scroll, zoom, search, selection, and tree changes.
- Blank-canvas pan, drag edit, marquee selection, create, and context-menu hit-tests now explicitly ignore the minimap layer so navigation clicks do not leak into edit interactions.
- Added regression coverage in `test/unit/focustree-minimap.test.ts` for negative-coordinate bounds projection, viewport rectangle conversion, and main-preview scroll targeting.
- Updated `CHANGELOG.md` within the existing `0.13.20` release line to record the large-tree minimap navigation work.
- Verification passed sequentially: `npm run compile-ts`, `npm run lint`, `npm test`, `npm run package`.
- Packaged VSIX: `C:\Users\Administrator\Documents\Code\hoi4modutilities\hoi4modutilities-0.13.20.vsix`.
- Manual VS Code preview smoke for live minimap drag, tooltip, and jump behavior was not run in this terminal session.
