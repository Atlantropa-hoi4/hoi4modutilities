# AGENTS.md

Repository-local guidance for coding agents working in `server.hoi4modutilities`, a desktop VS Code extension for Hearts of Iron IV modding workflows.

## Scope

These instructions apply to the whole repository unless a nested `AGENTS.md` provides a more specific override.

## Repository Map

- `src`: extension-host TypeScript, activation, providers, services, parsers, indexers, utilities
- `webviewsrc`: webview entrypoints, preview UI, webview-side messaging
- `test`: unit, integration, UI tests, fixtures, fixture workspaces
- `scripts`: build, packaging, cleanup, verification helpers
- `static`, `demo`, `resource`, `i18n`, `l10n`: supporting assets and localisation resources
- `dist`, `out`: generated outputs; preserve unless the task explicitly requires rebuilding them

Primary entry points:

- `src/extension.ts`
- `src/ddsviewprovider.ts`
- `webviewsrc/*.ts`
- `package.json`

## Operating Rules

- Keep edits tightly scoped to the requested behavior.
- Prefer root-cause fixes over symptom patches, but avoid unrelated refactors and scope creep.
- Do not break VS Code extension packaging, activation events, contributed commands, menus, keybindings, languages, custom editors, or webview contributions.
- Preserve generated outputs unless rebuilding them is explicitly part of the task.
- Do not change dependency versions, package metadata, publisher identity, extension IDs, or VSIX packaging behavior unless required.
- Use repository tools such as `rg`, `fd`, and `jq` where they make inspection safer or faster.
- Before changing behavior, identify the relevant entry point, contribution, service, fixture, or test path.

## High-Risk Areas

Treat these as requiring extra care and targeted verification:

- Extension activation and deactivation behavior in `src/extension.ts`
- Custom editor registration and lifecycle, especially `src/ddsviewprovider.ts`
- Preview lifecycle, disposal, state restoration, webview CSP, and webview messaging
- Parser, formatter, validation, and indexing services
- Localisation files and key usage across `i18n` and `l10n`
- `package.json` contributions, activation events, commands, views, custom editors, scripts, and packaging metadata
- Cross-boundary contracts between `src` and `webviewsrc`

## Testing Expectations

Prefer fixture-backed or targeted tests for changes involving:

- Parsing or syntax handling
- Preview rendering or preview lifecycle
- Webview messaging
- Localisation
- Formatting
- Activation behavior
- Indexing or workspace scanning
- Custom editor behavior

Use the narrowest meaningful verification first, then broaden when risk warrants it.

## Standard Commands

Recommended local environment:

- Node.js 20 LTS
- npm 10+
- Windows when matching the packaged release workflow matters

- Install dependencies: `npm ci`
- Type-check: `npm run compile-ts`
- Extension-host type-check only: `npm run check-types:extension`
- Webview type-check only: `npm run check-types:webview`
- Build: `npm run build`
- Development build: `npm run build:dev`
- Watch extension-host type-check, webview type-check, and bundles together: `npm run watch`
- Compile tests to `out`: `npm run compile-tests`
- Lint: `npm run lint`
- Unit tests: `npm run test:unit`
- Full tests: `npm run test`
- VS Code integration/UI tests: `npm run test-ui`
- Package VSIX: `npm run package`
- Full verification: `npm run verify`
- Clean generated build/test output: `npm run clean`
- Clean only `dist` and `static`: `npm run clean:build`
- Clean only `out`: `npm run clean:out`

## Command Selection

- TypeScript-only changes: run `npm run compile-ts`; add `npm run lint` when style or static checks may be affected.
- While iterating locally, prefer `npm run watch`; the default VS Code build task runs `npm run build:dev`.
- For targeted test debugging, `npm run compile-tests` is the narrow compile step before running emitted tests from `out/test`.
- Parser, formatter, localisation, indexing, or service changes: run targeted/unit tests and relevant fixture-backed tests.
- Webview, preview, activation, or custom editor changes: run targeted tests plus `npm run test-ui` when feasible.
- Packaging, contribution, or metadata changes: run `npm run build` and consider `npm run package`.
- Broad or release-sensitive changes: run `npm run verify`.

## Task Tracking

For non-trivial multi-step work, update `tasks/todo.md` with:

- Concrete checklist items
- The current implementation status
- A short review note describing what changed and what was verified

Keep task notes factual and concise.

## Change Discipline

- Avoid unrelated formatting churn.
- Avoid mass rewrites unless the task requires them.
- Preserve existing public APIs and extension contribution contracts.
- Keep localisation keys stable unless the change explicitly requires migration.
- Keep fixtures minimal and representative.
- When touching generated artifacts, document why regeneration was necessary.

## Linked Guidance

Also consult, when present:

- `code_review.md`
- `docs/architecture/*.md`
- Nested `AGENTS.md` files for local overrides
