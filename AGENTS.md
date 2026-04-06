# AGENTS.md

This repository builds and packages the desktop VS Code extension `server.hoi4modutilities` for Hearts of Iron IV modding workflows.

## Repository Context

- Product / service: desktop VS Code extension for HOI4 mod previewing, parsing, custom editors, and tooling.
- Main directories:
  - `src`: extension host TypeScript, providers, services, and shared utilities.
  - `webviewsrc`: webview entrypoints and preview UI code for focus trees, events, world map, GUI, GFX, and MIO flows.
  - `test`: unit and integration coverage plus fixtures.
  - `scripts`: build and cleanup scripts.
  - `static`, `demo`, `resource`, `i18n`, `l10n`: packaged assets and localization resources.
  - `dist`, `out`: generated build and test outputs.
- Entry points:
  - `src/extension.ts`
  - `src/ddsviewprovider.ts`
  - webview entry modules under `webviewsrc/*.ts`
  - `package.json` contribution points and npm scripts
- High-risk areas:
  - preview lifecycle, webview messaging, and activation behavior
  - parser and localisation/index services that affect multiple preview types
  - packaged asset paths, VS Code contribution metadata, and release packaging
  - tests that rely on fixture workspaces or VS Code integration bootstrapping
- Non-negotiable constraints:
  - keep changes scoped to the requested behavior
  - do not break desktop VS Code extension packaging or activation events
  - prefer incremental fixes over broad refactors unless clearly required
  - preserve existing repo conventions and user changes outside the task scope

## Working Rules

### 1) Start with the right scope

- Restate the task in concrete terms before changing code.
- Inspect the relevant files, commands, tests, logs, errors, or fixtures first.
- Treat done as verified behavior, not just edited code.
- Avoid unrelated cleanup unless it is required for correctness.

### 2) Plan when the task is hard

- Use a written plan for work that is ambiguous, cross-cutting, or likely to span multiple iterations.
- Use `PLANS.md` for long-running or architecture-significant work if that file exists.
- For smaller changes, proceed directly once scope and verification are clear.

### 3) Execute with bias to action

- Prefer the simplest change that fully solves the problem.
- Fix root causes when feasible.
- Resolve reasonable ambiguities autonomously.
- Ask for clarification only when the choice is risky, irreversible, or blocked by missing information.
- Do not add dependencies, rewrite major areas, or broaden scope without clear need.

### 4) Verification is mandatory

- Never mark work complete without evidence.
- Run the smallest sufficient checks first, then broader validation as needed.
- For touched code, use the relevant subset of:
  - `npm run compile-ts`
  - `npm run build`
  - `npm run lint`
  - `npm run test:unit`
  - `npm run test-ui`
  - `npm run package`
  - `npm run verify`
- Add or update tests when changing behavior or fixing regressions that should stay fixed.
- If a check cannot be run, state exactly why it was skipped and what remains unverified.

## Standard Commands

- Install: `npm ci`
- Run locally: `npm run build` and launch the extension from VS Code Extension Development Host
- Test: `npm run test`
- Lint: `npm run lint`
- Format: no dedicated formatter is configured; follow existing TypeScript style and keep diffs minimal
- Type check: `npm run compile-ts`
- Build: `npm run build`
- Package: `npm run package`
- Full verification: `npm run verify`

## Done Means

A task is done only when all of the following are true:

- The requested behavior works end-to-end, or the reported issue no longer reproduces.
- Relevant verification has been run, or unrun checks are explicitly called out.
- The diff stays scoped to the task and avoids unrelated changes.
- Affected docs, fixtures, or developer notes are updated when needed.
- Remaining assumptions, risks, and follow-ups are stated clearly.

## Task Tracking

- For non-trivial multi-step work, maintain a concrete checklist in `tasks/todo.md`.
- Keep items checkable and update progress as work advances.
- Add a short review note covering what changed, how it was verified, and any remaining risks or follow-ups.

## Safety and Change Boundaries

- Do not make destructive changes without clear need and visibility.
- Do not hide uncertainty.
- Prefer reversible changes over hard-to-undo edits.
- Preserve user intent, repository conventions, and operational safety.

## Optional Linked Guidance

If these files exist, follow them:

- `PLANS.md` for major execution plans
- `code_review.md` for review criteria
- `docs/architecture/*.md` for system constraints
- deeper `AGENTS.md` files in subdirectories for local overrides
