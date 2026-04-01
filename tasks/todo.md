# HOI4 Mod Utilities Log-Based Runtime Diagnosis Todo

## Plan
- [ ] Reset the still-open runtime regression notes and use the provided VS Code log as the primary evidence source
- [ ] Inspect `main.log` and correlate any failures with this fork's activation, command registration, or preview/highlighting paths
- [ ] Identify the concrete root cause and implement the smallest fix if it is inside the extension codebase
- [ ] Verify locally and document any remaining manual validation step

## Notes
- User reports the same failure after multiple packaging iterations.
- The current investigation should prefer actual logged runtime failures over further manifest speculation.

## Review
- Implemented:
  - inspected the provided VS Code logs with a local JS runtime and confirmed the real failure path was `activate -> previewManager.register -> updateHoi4PreviewContextValue -> findPreviewProvider`
  - verified that the installed `0.13.2` package was still throwing during preview-provider probing on an active plaintext editor, which aborted extension activation before localisation highlighting and preview command wiring finished
  - changed preview-provider detection to fail safely per provider and changed preview-context updates to catch and degrade instead of crashing activation
  - bumped the package to `0.13.3` and documented the activation-crash fix in the changelog
- Verification:
  - `npm run compile-ts`: passed
  - `npm run lint`: passed
  - `npm test`: passed
  - `npm run package`: passed and produced `hoi4modutilities-0.13.3.vsix`
