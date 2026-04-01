# HOI4 Mod Utilities Lodash Chain Runtime Fix Todo

## Plan
- [ ] Inspect the exact `(0, m.chain)(...).map is not a function` runtime failure path in preview provider lookup
- [ ] Replace the fragile lodash chain usage with a native implementation that keeps preview selection behavior
- [ ] Verify with local build/test/package steps and document the resulting fix

## Notes
- User provided a concrete runtime error from the installed extension: `(0 , m.chain)(...).map is not a function`.
- The likely failure point is preview provider selection during activation, which matches the earlier log-based activation crash.

## Review
- Implemented:
  - confirmed the reported runtime error matched `previewManager.findPreviewProvider()` using lodash `chain(...)`
  - removed lodash `chain` from preview provider selection and replaced it with a native priority scan that preserves the same lowest-priority-wins behavior
  - bumped the packaged version to `0.13.4` and documented the runtime fix in the changelog
- Verification:
  - `npm run compile-ts`: passed
  - `npm run lint`: passed
  - `npm test`: passed
  - `npm run package`: passed and produced `hoi4modutilities-0.13.4.vsix`
