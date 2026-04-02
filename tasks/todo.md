# HOI4 Mod Utilities Localisation Highlighting Performance Todo

## Plan
- [x] Inspect the localisation highlighting refresh path and identify the hot spots causing delayed recognition
- [x] Reduce unnecessary rescans/re-decoration work while preserving the existing highlighting behavior
- [x] Add regression coverage where practical, run verification, and record the result

## Notes
- The user reports that localisation highlighting is recognized too slowly.
- The likely hot path is extension-host decoration refresh rather than localisation parsing correctness.
- Keep the visible feature set unchanged: same detection rules, same color/token decoration categories.

## Review
- The hot path was the extension host refresh loop, not the parser itself: localisation decorations were recomputed from full document text on every eligible refresh, including `onDidChangeTextEditorVisibleRanges` while scrolling.
- Removed the `visibleRanges`-driven rescan path, narrowed scheduled refreshes to changed documents when possible, and cached localisation analysis by document URI + version.
- Added an editor-level applied-state check so unchanged documents do not re-send the same decoration arrays after the initial pass or after simple focus changes.
- Detection still uses the same path/token/text rules, but non-path fallback now samples the leading document lines without materializing the whole file just to decide whether highlighting should run.
- Verification:
  - `npm run compile-ts` passed.
  - `npm run lint` passed.
  - `npm test` passed.
  - `npm run package` passed and produced `hoi4modutilities-0.13.7.vsix`.
