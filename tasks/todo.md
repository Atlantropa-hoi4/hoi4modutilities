# HOI4 Mod Utilities CI Failure Triage Todo

## Plan
- [x] Confirm the actual failing GitHub Actions step instead of relying on Copilot's guess
- [x] Reproduce the failing `Verify #39` commit under the workflow's Node 20 runtime in an isolated checkout
- [x] Decide whether a code/workflow fix is needed or whether the current evidence only disproves the Copilot diagnosis
- [x] Record the investigation result, evidence, and any remaining blind spots

## Notes
- The failing GitHub Actions run is `Verify #39` for commit `191d77b`.
- GitHub metadata already confirms the failing step is `Run unit verification`; later steps were skipped.
- Local baseline on the current checkout already shows `npm run compile-ts` and `npm run test:unit` passing, including under `Node 20`.

## Review
- GitHub Actions metadata for `Verify #39` (`191d77b`) and `Verify #41` (`5f379e9`) confirms the real failing step was `Run unit verification`; `Compile TypeScript` and `Run lint` succeeded and later steps were skipped.
- Copilot's explanation was only partially right: it was correct that the failure sat in `npm run test:unit`, but the broad guesses about missing `out/` output or incomplete compilation were not the real root cause.
- An isolated fresh worktree for `191d77b` reproduced the unit-test failure, and a fresh worktree for current `HEAD` reproduced the same class of failure on Windows checkout line endings.
- The actionable root cause was a CRLF-sensitive regex in `test/unit/focustree-positionedit.test.ts` for the shared-focus template assertion. Fresh Windows-style checkouts produced `\r\n`, while the test only allowed `\n`.
- Updated that assertion to accept both `LF` and `CRLF` using `\r?\n`, which keeps the behavior check intact without changing product code.
- Verification passed on the main checkout: `npm run compile-ts` and `npm run test:unit`.
- Verification also passed in a fresh detached `HEAD` worktree after the same test fix, which is the closest local reproduction of the GitHub Actions Windows checkout path.
- I did not rerun the actual GitHub Actions workflow from here, so final confirmation still depends on the next remote CI run.
