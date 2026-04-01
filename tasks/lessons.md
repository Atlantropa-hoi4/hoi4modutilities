# Lessons

- When adding editor-event listeners in the extension host, always guard refresh callbacks with `try/catch` or an error-reporting boundary before shipping. Unit tests can pass while runtime-only editor events still throw and surface as `FAILED to handle event`.
- When forking a VS Code extension for side-by-side installation, changing only `publisher` is not enough. Commands, custom editor view types, webview types, and extension-owned context keys also need unique fork-specific namespaces or activation can fail due to duplicate registrations.
- When a user says a packaged VSIX fix still behaves the same, do not assume the previous root-cause theory was sufficient. Re-check activation events, menu `when` clauses, and whether the build version changed enough for the new package to be unmistakably installed.
