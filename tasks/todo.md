# Focus Preview Lint Badge Removal Todo

## Plan
- [ ] Audit the remaining per-focus lint badge render path
- [ ] Remove node-level lint badge markup and styles while keeping lint data in warnings
- [ ] Re-run `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`
- [ ] Record review notes and a lesson from this correction

## Notes
- Scope is limited to the small badge shown on focus nodes.
- Structural lint data and warnings panel output should remain intact.
