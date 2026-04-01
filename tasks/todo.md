# HOI4 Mod Utilities Focus Preview Runtime Cleanup Todo

## Plan
- [ ] Capture the newly reported duplicate focus preview button and remaining lodash `chain(...).flatMap()` runtime failure
- [ ] Inspect the focus preview hot paths for remaining lodash chain usage that can execute at runtime
- [ ] Restore a single preview toolbar entry and replace the risky chain-based hot paths with native logic
- [ ] Verify with local build/test/package steps and document the resulting fix

## Notes
- User reports two concrete issues after `0.13.4`: duplicate focus preview toolbar buttons and `TypeError: (0 , s.chain)(...).flatMap is not a function`.
- The previous fix only removed one chain usage in preview provider selection; more runtime chain usage remains in focus-preview code.

## Review
- Implemented:
  - fixed the duplicate preview toolbar entry by making the fallback preview button conditional on `!server.shouldShowHoi4Preview`
  - removed remaining lodash `chain(...).flatMap()` usage from focus preview runtime paths in `focustree/loader.ts` and `focustree/schema.ts`
  - kept the same focus-preview behavior using native `flatMap`, `Set`, and simple loops instead of brittle chain wrappers
  - bumped the package version to `0.13.5` and documented the runtime cleanup in the changelog
- Verification:
  - `npm run compile-ts`: passed
  - `npm run lint`: passed
  - `npm test`: passed
  - `npm run package`: passed and produced `hoi4modutilities-0.13.5.vsix`
