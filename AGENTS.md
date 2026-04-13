# AGENTS.md

Repository-specific guidance for `server.hoi4modutilities`, a desktop VS Code extension for Hearts of Iron IV modding workflows.

## Repository Context

- Main code:
  - `src`: extension-host TypeScript, providers, services, parsers, and utilities
  - `webviewsrc`: webview entrypoints and preview UI code
  - `test`: unit and integration tests plus fixture workspaces
  - `scripts`: build and cleanup scripts
- Supporting assets:
  - `static`, `demo`, `resource`, `i18n`, `l10n`
  - `dist`, `out` are generated outputs
- Primary entry points:
  - `src/extension.ts`
  - `src/ddsviewprovider.ts`
  - `webviewsrc/*.ts`
  - `package.json` contributions and npm scripts

## Repository Constraints

- Keep changes tightly scoped to the requested behavior.
- Do not break desktop VS Code extension packaging, activation events, or contributed commands/editors.
- Treat preview lifecycle, webview messaging, parser/index services, and packaging metadata as high-risk areas.
- Prefer fixture-backed or targeted tests when changing parsing, preview, localisation, or activation behavior.

## Standard Commands

- Install: `npm ci`
- Type check: `npm run compile-ts`
- Build: `npm run build`
- Lint: `npm run lint`
- Unit tests: `npm run test:unit`
- Full test pass: `npm run test`
- VS Code integration tests: `npm run test-ui`
- Package VSIX: `npm run package`
- Full verification: `npm run verify`

## Task Tracking

- For non-trivial multi-step work, update `tasks/todo.md` with concrete checklist items and a short review note.

## Linked Guidance

- `code_review.md` if present
- `docs/architecture/*.md` if present
- nested `AGENTS.md` files for local overrides
