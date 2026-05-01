# Repository Guidelines

## Project Structure & Module Organization

Taskix is a Next.js 16 TypeScript app. Application routes and API handlers live in `src/app`; reusable UI lives in `src/components`; server-side workflow, GitHub, Codex, Telegram, settings, and storage logic lives in `src/lib`. Global styles are in `src/app/globals.css`. Local runtime state is expected under `data/` and should not be committed. Project configuration is in `package.json`, `tsconfig.json`, and `next.config.mjs`.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start the local Next.js server at `http://127.0.0.1:8000`.
- `npm run build`: create a production build and catch Next.js build errors.
- `npm run start`: serve the production build on `127.0.0.1:8000`.
- `npm run typecheck`: run `tsc --noEmit` for TypeScript validation.
- `npm test`: run the Node-based automated test suite in `scripts/*.test.mjs`.
- `npm run test:issue-run`: run the focused issue-run policy simulation.

Before running workflows, confirm the external CLIs work locally: `codex --version`, `codex login`, and `gh auth status`.

## Coding Style & Naming Conventions

Use TypeScript and React server components by default in `src/app`; mark components with `"use client"` only when they need client-side state or browser APIs. Follow the existing style: two-space indentation, double quotes, semicolons, named exports for shared helpers, and path aliases such as `@/lib/store`. Components use PascalCase file names such as `ProjectChatArea.tsx`; library modules use lowercase kebab names such as `pm-handoff.ts`.

## Testing Guidelines

Use the Node built-in test runner for repeatable behavior checks. Test files live in `scripts/*.test.mjs` and may import TypeScript source through `node --experimental-strip-types`. Run `npm test`, `npm run typecheck`, and `npm run build` before handing work to QA. Add or update tests for changed business logic, workflow state derivation, label policy, parsing, and other deterministic behavior. If a change cannot reasonably be automated, state why in the PR and provide a targeted manual QA scenario.

Prefer tests that exercise pure helpers in `src/lib`, for example `scripts/workflow-next-action.test.mjs`. Keep test names behavior-focused and cover the practical states QA must verify, such as pending, running, blocked, and idle workflow states.

## Developer and QA Workflow

All development work should start from a GitHub issue. Create a feature branch from the latest `main` using a descriptive issue-based name such as `issue-12-add-retry-controls`, implement the change there, and open a pull request back to `main`. Do not commit feature work directly to `main` except for explicit repository setup or emergency maintenance.

Developers implement the requested change, add repeatable test cases where feasible, run baseline checks, and create or update the GitHub issue with QA instructions. Treat QA as an independent validator, not as a code co-author. The QA issue should include the requirement, changed files, acceptance criteria, automated test commands, expected test cases, and any targeted browser scenarios to verify.

QA should validate the submitted test cases first, then perform focused web UI checks for the user-visible path. Manual clicking is not a substitute for repeatable tests; it is used to confirm that the tested behavior is wired correctly in the browser. For workflow UI changes, QA should run `npm run dev`, visit the affected project page, trigger the relevant controls, and confirm the visible next action matches the issue acceptance criteria.

QA should test from user-visible behavior and leave a GitHub issue comment with:

- `Status: pass`, `fail`, or `blocked`.
- Commands run, including `npm test`, `npm run typecheck`, and `npm run build`.
- Automated test cases covered and their result.
- Manual browser scenarios tested.
- For UI or interaction changes, browser validation run with `npm run dev` at `http://127.0.0.1:8000`.
- Pages visited, controls clicked, and observed results for browser validation.
- Screenshots, or a concise visual description when screenshots are not available.
- Findings with severity, reproduction steps, expected result, and actual result.
- Any untested areas or environment limits.

When QA passes, add the `qa-passed` label. When QA fails, add `qa-failed` and comment with the failure details. Developers should address failed QA findings in a follow-up commit and request another QA pass on the same issue. When requesting QA recheck after a developer fix, remove `qa-failed` / `taskix:qa-failed` and add `taskix:need-qa` on both the source issue and PR so the workflow is back in QA-required state. Merge the PR into `main` only after QA has passed.

## Commit & Pull Request Guidelines

The GitHub repository is `git@github.com:Taskix-AI/Taskix.git`. Use concise, imperative commit subjects, for example `Add workflow retry controls`. Pull requests should link the source issue, summarize the problem and implemented change, list verification commands, report QA issue status, and include screenshots for UI changes.

## Security & Configuration Tips

Keep secrets in `.env` or local settings, never in source files. Common local variables include `APP_BASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CODEX_BIN`, `GITHUB_TOKEN`, `GITHUB_REPO`, and `DATA_DIR`. Do not commit generated SQLite files, SSH keys, Codex session data, or other contents from `data/`.

<!-- taskix:workflow:start -->
## Taskix Workflow

Project: Issue 16 QA Worktree

Minimal local QA smoke workflow for main-flow E2E validation:

- Workflow ID: `WF-20260430-001`
- Implementation issue: https://github.com/Taskix-AI/Taskix/issues/23
- QA smoke job name: `taskix-main-flow-local-smoke`
- Scope: no-deploy validation only; run locally against `npm run dev` at `http://127.0.0.1:8000`
- Required sessions/accounts: local Node/npm environment, authenticated `gh` session, authenticated `codex` session, and one local browser session for manual validation
- Execution timeline/order:
  1. Confirm `codex --version`, `codex login`, and `gh auth status`.
  2. Run `npm run typecheck`.
  3. Run `npm run build`.
  4. Start the app with `npm run dev`.
  5. Execute the `taskix-main-flow-local-smoke` manual browser pass against `http://127.0.0.1:8000` and record outcomes.
  6. Add QA evidence to the implementation issue before architect review and merge readiness.
- GitHub links:
  - Source issue: https://github.com/Taskix-AI/Taskix/issues/23
  - Implementation PR: https://github.com/Taskix-AI/Taskix/pull/24
  - QA evidence record: issue `#23` comments thread at https://github.com/Taskix-AI/Taskix/issues/23
- Architect merge-readiness inputs: confirmation that the smoke job passed or failed, the exact commands run, the browser scenarios exercised, and the final QA evidence link on issue `#23`

Planning-only safe main-flow smoke recheck for Issue 15:

- Workflow ID: `WF-20260430-004`
- Planning issue: https://github.com/Taskix-AI/Taskix/issues/32
- Scope: documentation-only planning for a safe main-flow smoke recheck; no deployment work is in scope
- Execution stop point: implementation stops after planning is documented in repository guidance
- Job handling: any `issue_run` jobs are only queued for later manual Run Jobs execution and are not executed as part of this work

- PM keeps talking with the user and hands confirmed requirements to the architect.
- Architect creates issues with developerRole and ownedPaths.
- Developers must stay inside ownedPaths.
- QA must validate every developer PR before merge.
- Architect may merge only after QA passes.
- DevOps owns deployment setup, GitHub Actions/CD workflow, deployment secrets guidance, release automation, and rollback planning.
- Automatic deployment is disabled until manual approval or DevOps enables CD.
<!-- taskix:workflow:end -->
