# HOI4 Mod Utilities Focus Preview Link Edit Todo

## Plan
- [ ] Add focus-link edit metadata and message contracts for `prerequisite` and `relative_position_id` writes
- [ ] Implement host-side writeback helpers that can add or replace parent/child links in the current document without reformatting whole blocks
- [ ] Extend the focus preview webview with a double-click link mode, pending-link overlay state, and target selection flow
- [ ] Preserve current edit-mode behaviors so drag, single-click navigation, blank-space create, and link editing do not fight each other
- [ ] Add regression tests for prerequisite insertion/replacement, relative-position updates, and invalid link scenarios
- [ ] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [ ] Record review results and remaining live-editor smoke gaps

## Notes
- User request: when an existing focus is double-clicked in edit mode, start a connection line from that focus. Clicking another focus should connect the first focus as the parent and the selected second focus as the child.
- The saved result should add or update the child focus's `prerequisite` and `relative_position_id` based on the selected parent-child pair.
- The current preview already has edit-mode drag, single-click navigation, and blank-space double-click create flows, so the new link-edit gesture must avoid conflicting with those handlers.
- `prerequisite` is parsed as `string[][]`, so the writeback path needs to decide whether to append a simple `focus = PARENT_ID` prerequisite or preserve/extend existing OR groups.
- `relative_position_id` is a single string, so linking should either insert it when missing or replace the existing value with the selected parent id.
- Imported focuses and trees should remain read-only: linking must only write to child focuses that belong to the current document.

## Review
- Pending implementation.
