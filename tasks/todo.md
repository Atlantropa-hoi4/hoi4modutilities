# HOI4 Mod Utilities Focus Preview Structural Lint Todo

## Plan
- [x] Inspect the current focus warning flow, badge rendering path, and relation/runtime metadata needed for lint aggregation
- [x] Extend the warning model so parse warnings and structural lint share one typed collection
- [x] Add a pure `focuslint.ts` helper that computes asymmetric exclusive, relative-position mismatch, missing reference, and unreachable-candidate findings
- [x] Feed lint results into `getFocusTree(...)` so each tree exposes ordered warnings plus per-focus lint counts/messages
- [x] Render lint badges and lint summaries in the existing focus status / relation UI without breaking hit targets
- [x] Restructure the warnings panel output to show `[severity][code][kind][source]` entries with lint findings first
- [x] Add unit coverage for lint rules and runtime warning ordering/aggregation
- [x] Run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [x] Record review notes, verification results, and any environment-blocked checks

## Notes
- Scope for this pass is structural lint surfacing only; no new host/webview message contracts and no writeback behavior changes.
- Lint must reuse the existing warnings panel plus node-level badges rather than introducing a new panel or sidebar.
- `candidate unreachable` remains `info` severity because branch/condition runtime flow is not fully simulated.

## Review
- Generalized `FocusWarning` so parse warnings and structural lint now share one typed collection with `code`, `severity`, `kind`, `relatedFocusIds`, and optional navigations.
- Added `src/previewdef/focustree/focuslint.ts` as a pure helper that computes asymmetric `mutually_exclusive`, `relative_position_id` without matching prerequisite, missing prerequisite/exclusive targets, and unreachable-candidate findings.
- Wired lint aggregation into `schema.ts` so every focus tree now carries sorted warnings plus per-focus `lintWarningCount`, `lintInfoCount`, and `lintMessages`.
- Updated focustree inlay warning producers and loader post-processing so inlay-originated warnings still satisfy the expanded warning contract and the tree warning list stays lint-first after inlay resolution.
- Added preview lint surfacing in the existing UI: node-level lint pills, lint lines in hover status summaries and relation summaries, and a structured warnings panel with clickable navigation entries.
- Added `test/unit/focustree-lint.test.ts` covering asymmetric exclusive detection, relative-position mismatch, missing targets, unreachable candidates, imported-target false-positive avoidance, and lint-before-parse ordering.
- Verification passed: `npm run compile-ts`, `npm run lint`, `npm test`, `npm run package`.
- Packaged VSIX: `C:\\Users\\Administrator\\Documents\\Code\\hoi4modutilities\\hoi4modutilities-0.13.20.vsix`.
- Manual VS Code smoke for lint badge placement, warnings-panel click navigation, and large-tree partial refresh behavior was not run in this terminal session.
