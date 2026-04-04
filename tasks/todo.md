# Focus Preview Relative Position Anchor Todo

## Plan
- [x] Audit the current multi-parent link anchor path and confirm where `relative_position_id` is chosen
- [x] Change the webview link flow so grouped parent links choose the top-most selected focus as the `relative_position_id` anchor
- [x] Keep grouped prerequisite writeback and optimistic UI in sync with the new anchor rule
- [x] Add regression coverage for top-most-anchor selection in multi-parent links
- [x] Re-run `npm run compile-ts`, `npm run lint`, `npm test`, `npm run package`
- [x] Record review notes and a lesson from this correction

## Notes
- Scope is limited to grouped `Link focus` behavior after multi-select.
- The prerequisite block should stay grouped; only the `relative_position_id` anchor rule changes.

## Review
- Multi-selected link groups now choose the top-most rendered parent focus as the `relative_position_id` anchor instead of blindly reusing the clicked focus.
- The grouped prerequisite block behavior stays unchanged; only the anchor id sent through the webview apply path changed.
- Added a pure helper in `src/previewdef/focustree/relationanchor.ts` and regression coverage in `test/unit/focustree-relationanchor.test.ts` so the top-most-anchor rule is locked down outside the webview.
- Verified with `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
