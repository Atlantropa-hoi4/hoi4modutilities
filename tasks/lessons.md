# Lessons

- When adding editor-event listeners in the extension host, always guard refresh callbacks with `try/catch` or an error-reporting boundary before shipping. Unit tests can pass while runtime-only editor events still throw and surface as `FAILED to handle event`.
- When forking a VS Code extension for side-by-side installation, changing only `publisher` is not enough. Commands, custom editor view types, webview types, and extension-owned context keys also need unique fork-specific namespaces or activation can fail due to duplicate registrations.
- When a user says a packaged VSIX fix still behaves the same, do not assume the previous root-cause theory was sufficient. Re-check activation events, menu `when` clauses, and whether the build version changed enough for the new package to be unmistakably installed.
- When a visibility or highlighting fix still fails after a manifest tweak, verify the real document language IDs in the target workflow before iterating again. HOI4 companion extensions may use IDs different from `plaintext`, `hoi4`, or `paradox`, and brittle menu gates hide the real issue.
- When the user provides a concrete VS Code log file for an unresolved runtime issue, stop iterating on hypotheses and anchor the next fix to the logged error first.
- When a runtime error points at a utility abstraction like lodash `chain`, prefer replacing that abstraction on the hot path with a small native implementation instead of trying to preserve a brittle shimmed chain API.
- When broadening menu visibility as a fallback, keep the fallback entry mutually exclusive with the context-driven entry or VS Code will render duplicate toolbar buttons.
- When the user reports one surface is fixed but another still fails, narrow the next pass to that subsystem only instead of reopening the whole activation theory.
- When the user offers a concrete edge-case hypothesis like a spaced localisation filename, turn it into a direct regression test instead of only broadening the theory in prose.
- Do not bump the extension version for every intermediate debugging pass. In this repo, keep version changes for intentional release batches or user-facing install points, and group multiple small fixes under one planned version when possible.
