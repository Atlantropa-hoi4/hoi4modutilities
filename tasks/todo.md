# HOI4 Mod Utilities Final Release Check And Version Bump Todo

## Plan
- [x] Inspect the current release state, working tree, and version metadata before bumping
- [x] Update `package.json`, `package-lock.json`, and `CHANGELOG.md` to the final release version `0.13.21`
- [x] Re-run the release verification chain used in this repo: `npm run compile-ts`, `npm run lint`, `npm test`, `npm run package`
- [x] Confirm the packaged VSIX matches the bumped version and capture any environment-blocked checks
- [x] Record review notes and final verification results

## Notes
- Scope for this pass is final release consolidation only; no new feature work should be introduced.
- The release line is intentionally moving from `0.13.20` to `0.13.21` as the final bundled version for the completed focus-preview batch.

## Review
- Bumped the extension release metadata from `0.13.20` to `0.13.21` in `package.json`, the root package entries in `package-lock.json`, and the latest section header in `CHANGELOG.md`.
- Kept the release notes otherwise intact so the completed focus-preview batch remains grouped under a single latest release section.
- Verification passed in the expected repo sequence: `npm run compile-ts`, `npm run lint`, `npm test`, `npm run package`.
- Final packaged artifact: `C:\\Users\\Administrator\\Documents\\Code\\hoi4modutilities\\hoi4modutilities-0.13.21.vsix`.
- Manual VS Code smoke after reinstalling the bumped VSIX was not run in this terminal session.
