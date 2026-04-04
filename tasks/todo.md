# Focus Preview Icon GFX Loading Todo

## Plan
- [x] Audit the icon pipeline from `icon = GFX_*` parsing through GFX container discovery and webview class substitution
- [x] Fix the root cause so focus preview resolves registered GFX icons before falling back to the default icon
- [x] Record review notes and rerun compile, lint, test, and package

## Notes
- Scope is limited to focus preview icon resolution for `icon = GFX_*` entries.
- The fix should preserve existing fallback behavior for genuinely missing sprites.

## Review
- Root cause was that focus preview icon loading depended too heavily on the optional GFX index and the static `interface/goals.gfx` fallback, so workspace-local mod icons could miss resolution even when their `GFX_*` names existed in other `.gfx` containers.
- Added a focused fallback resolver that keeps indexed hits, then scans `interface/*.gfx` only for unresolved icon names and feeds the matched container files back into the focus tree loader.
- Added regression tests for indexed-hit preservation and multi-icon fallback resolution, then verified with `npm run compile-ts`, `npm run lint`, `npm test`, and `npm run package`.
