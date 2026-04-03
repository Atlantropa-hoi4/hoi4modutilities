# HOI4 Mod Utilities Release Automation Todo

## Plan
- [x] Inspect the current GitHub Actions, packaging scripts, and repository release conventions
- [x] Add a tag-driven GitHub release workflow that rebuilds and verifies the extension before publishing assets
- [x] Document the intended release trigger and asset outcome so the repository workflow is discoverable
- [x] Run local validation for workflow/package commands and capture the results

## Notes
- Assume the release contract is: push a semantic version tag like `v0.13.20`, then GitHub Actions builds the VSIX and creates or updates a GitHub Release with the packaged asset attached.
- Keep the existing `verify.yml` repository verification path intact unless a release-flow dependency requires a small adjustment.
- Verification should stay rooted at the repository root and favor the established sequence around compile, lint, tests, and VSIX packaging.

## Review
- Added `.github/workflows/release.yml` so pushing a tag like `v0.13.20` now rebuilds the extension on `windows-latest`, checks that the tag matches `package.json`, runs compile/lint/unit/UI/package verification, generates a `.sha256` checksum, and uploads both release assets to the GitHub Release for that tag.
- Updated `.github/workflows/verify.yml` to split `lint` and `test:unit` into explicit steps, so CI and release logs show the failing stage directly instead of hiding both inside `npm test`.
- Documented the tag-based release contract in `README.md` with the exact `git tag` and `git push origin` trigger flow.
- Workflow YAML parsing passed for both `.github/workflows/verify.yml` and `.github/workflows/release.yml`.
- Local verification passed: `npm run compile-ts`, `npm run lint`, `npm run test:unit`, and `npm run package`.
- Local `npm run test-ui` did not complete in this terminal environment because `@vscode/test-electron` failed with `spawn EPERM` right after downloading VS Code. The workflow still keeps that gate enabled, but this session could not prove it locally due the host execution restriction.
