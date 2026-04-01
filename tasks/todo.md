# HOI4 Mod Utilities Focus Preview Todo

## Plan
- [x] Normalize quoted `.mod` paths before URI parsing and add regression coverage
- [x] Complete `joint_focus` preview behavior so direct files and linked trees surface consistently
- [x] Add focus-tree inlay window parsing, loading, rendering, and toggle UI without bringing over titlebar or overlay features
- [x] Verify with targeted tests plus `npm run compile-ts`, `npm run lint`, and `npm test`

## Notes
- Scope is intentionally limited to the fork features the user requested: bugfix, `joint_focus`, and `inlay windows` only.
- Do not add custom titlebar or focus overlay support in this slice.
- Keep existing command IDs, settings keys, and focus preview entry points stable.
- Use the Millennium Dawn fork only as a reference; adapt changes to the modernized local codebase rather than copying blindly.

## Review
- Implemented:
  - added quote-stripping path normalization before `.mod` URI parsing so pasted `"C:\...\file.mod"` values resolve correctly
  - changed focus indexing to collect IDs from `focus_tree`, `shared_focus`, and `joint_focus`, which lets linked trees resolve joint-focus files
  - split top-level `joint_focus` into its own preview tree instead of folding it into shared focuses, while still allowing linked `focus_tree.shared_focus` references to import joint focuses
  - added focus-tree inlay window parsing, scripted GUI resolution, inlay GFX resolution, webview rendering, and toolbar toggles
  - kept custom titlebar and focus overlay work out of scope
- Verification:
  - `npm test`: passed
  - `npm run package`: passed and produced `hoi4modutilities-0.13.0.vsix`
- Additional validation details:
  - new unit tests cover quoted path normalization and `joint_focus` plus `inlay_window` parsing/linking fixtures
  - `PromiseCache` cleanup timers now call `unref()` so unit tests can exit cleanly when cache-backed modules are imported
