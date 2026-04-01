# HOI4 Mod Utilities Modernization Todo

## Plan
- [x] Phase 1: Recover local dependencies and normalize the build / test / packaging toolchain
- [x] Phase 1: Replace sample tests with real parser, loader, and extension smoke coverage
- [x] Phase 2: Update the extension to current desktop-only VS Code standards
- [x] Phase 2: Tighten webview security and clean up desktop-only code paths
- [x] Phase 3: Extend parser / schema / scope support for newer HOI4 syntax
- [x] Phase 3: Add regression fixtures that cover old and new HOI4 script constructs
- [ ] Verify `npm run compile-ts`, `npm run lint`, `npm test`, `npm run test-ui`, and `npm run package`

## Notes
- Scope is desktop VS Code only.
- Public command IDs, custom editor view types, and settings keys must remain stable.
- Parser work should be additive and keep older HOI4 mod syntax working.

## Review
- `npm run compile-ts`: passed.
- `npm run lint`: passed with no errors.
- `npm test`: passed with fixture-backed parser, dependency-header, and event-schema coverage.
- `npm run package`: passed and produced `hoi4modutilities-0.12.2.vsix`.
- `npm run test-ui`: blocked in this environment because the VS Code host launch failed with `spawn EPERM` after downloading the stable test binary.
