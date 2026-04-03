# HOI4 Mod Utilities Focus Preview Edit Removal Todo

## Plan
- [x] Identify all focus preview edit-related code paths, settings, migrations, tests, and release notes that must be removed while preserving normal preview behavior
- [x] Remove the focus preview edit UI, edit message flow, and layout-edit data plumbing from the focus preview implementation
- [x] Delete edit-only support files and update manifest, changelog, and tests so no focus edit surface remains
- [x] Run compile, lint, tests, and package, then record review notes including any manual verification limits

## Notes
- Scope is limited to Focus Preview edit functionality and its residue.
- Normal focus preview rendering, pan, search, conditions, inlay display, and navigation should remain intact.
- The result should behave like the pre-edit preview rather than leaving edit controls hidden behind settings.

## Review
- Removed the Focus Preview `Edit` toggle, webview drag/apply message flow, layout-edit metadata plumbing, edit-only support modules, legacy setting migration, and manifest configuration so focus preview returns to non-editable behavior.
- Deleted edit-specific tests and updated manifest coverage to reflect the reverted preview surface.
- Verification passed with `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
- Manual VS Code smoke verification was not run in this terminal session, so preview interaction was validated through automated build/test/package checks only.
