# HOI4 Mod Utilities Identity Rename Todo

## Plan
- [x] Inventory the current extension identity references and lock the rename scope to distribution metadata only
- [x] Rename the packaged extension identity from `chaofan.hoi4modutilities` to `server.hoi4modutilities`
- [x] Update display metadata, docs, and tests so the fork is clearly distinguishable while commands/settings remain stable
- [x] Verify with `npm run compile-ts`, `npm run lint`, and `npm test`

## Notes
- Keep command IDs, view types, and `hoi4ModUtilities.*` setting keys unchanged to preserve user-facing compatibility.
- Use the current fork remote as the repository source of truth for metadata updates.
- Make the fork distinction visible in Marketplace/UI without implying compatibility breakage beyond the new extension ID.

## Review
- Implemented:
  - changed the packaged extension identity to `server.hoi4modutilities` by updating the manifest publisher while keeping the extension package name, command IDs, view types, and `hoi4ModUtilities.*` setting keys stable
  - updated display metadata to show the fork as `HOI4 Mod Utilities (Server)` across manifest localization files
  - pointed repository and issue metadata at the current fork remote and documented the independent fork identity in the README
  - updated the integration smoke test to activate `server.hoi4modutilities`
  - recorded the rename in the changelog
- Verification:
  - `npm run compile-ts`: passed
  - `npm run lint`: passed
  - `npm test`: passed
  - `npm run package`: passed and produced `hoi4modutilities-0.13.0.vsix`
- Compatibility notes:
  - existing command IDs remain unchanged
  - existing configuration keys remain unchanged
  - the new publisher means VS Code will treat this as a distinct extension from `chaofan.hoi4modutilities`
