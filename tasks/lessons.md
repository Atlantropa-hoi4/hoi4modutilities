# Lessons

- When adding editor-event listeners in the extension host, always guard refresh callbacks with `try/catch` or an error-reporting boundary before shipping. Unit tests can pass while runtime-only editor events still throw and surface as `FAILED to handle event`.
