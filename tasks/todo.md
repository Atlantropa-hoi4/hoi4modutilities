# HOI4 Mod Utilities Focus Preview Drag Edit UX Todo

## Plan
- [x] Make edit-mode dragging feel more responsive without breaking grid-snapped save behavior
- [x] Allow single-click navigation to the focus definition even while edit mode is enabled
- [x] Re-run compile, lint, tests, and package after the input-model update
- [x] Record the UX behavior change and remaining live smoke gap

## Notes
- New user report: drag feels too sluggish, and edit mode should still allow single-click navigation to the focus definition.
- The intent is drag-to-edit plus click-to-navigate, with click suppression only after an actual drag gesture.

## Review
- Edit mode now distinguishes a click from a drag with a small pixel threshold, so drag feedback begins from a light motion instead of waiting for a whole grid-step change.
- Single-click navigation is restored in edit mode. Only an actual drag suppresses the follow-up click, which keeps direct navigation to the focus definition working while preventing accidental jumps after moving a node.
- Verification passed with `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- Manual VS Code smoke is still the remaining proof point for the exact drag feel in the live preview.
