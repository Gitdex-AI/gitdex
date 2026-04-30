# Repository Guidelines

## Project Structure & Module Organization

Taskix is a Next.js 16 TypeScript app. Application routes and API handlers live in `src/app`; reusable UI lives in `src/components`; server-side workflow, GitHub, Codex, Telegram, settings, and storage logic lives in `src/lib`. Global styles are in `src/app/globals.css`. Local runtime state is expected under `data/` and should not be committed. Project configuration is in `package.json`, `tsconfig.json`, and `next.config.mjs`.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start the local Next.js server at `http://127.0.0.1:8000`.
- `npm run build`: create a production build and catch Next.js build errors.
- `npm run start`: serve the production build on `127.0.0.1:8000`.
- `npm run typecheck`: run `tsc --noEmit` for TypeScript validation.

Before running workflows, confirm the external CLIs work locally: `codex --version`, `codex login`, and `gh auth status`.

## Coding Style & Naming Conventions

Use TypeScript and React server components by default in `src/app`; mark components with `"use client"` only when they need client-side state or browser APIs. Follow the existing style: two-space indentation, double quotes, semicolons, named exports for shared helpers, and path aliases such as `@/lib/store`. Components use PascalCase file names such as `ProjectChatArea.tsx`; library modules use lowercase kebab names such as `pm-handoff.ts`.

## Testing Guidelines

There is no dedicated test runner configured yet. For now, use `npm run typecheck` and `npm run build` as the baseline verification for code changes. If adding tests, keep them close to the behavior under test and prefer clear names such as `pm-handoff.test.ts` or `ProjectChatArea.test.tsx`. Document any new test command in `package.json` and this file.

## Developer and QA Workflow

All development work should start from a GitHub issue. Create a feature branch from the latest `main` using a descriptive issue-based name such as `issue-12-add-retry-controls`, implement the change there, and open a pull request back to `main`. Do not commit feature work directly to `main` except for explicit repository setup or emergency maintenance.

Developers implement the requested change, run baseline checks, and create or update the GitHub issue with QA instructions. Treat QA as an independent validator, not as a code co-author. The QA issue should include the requirement, changed files, acceptance criteria, commands to run, and manual scenarios to verify.

QA should test from user-visible behavior and leave a GitHub issue comment with:

- `Status: pass`, `fail`, or `blocked`.
- Commands run, including `npm run typecheck` and `npm run build`.
- Manual scenarios tested.
- For UI or interaction changes, browser validation run with `npm run dev` at `http://127.0.0.1:8000`.
- Pages visited, controls clicked, and observed results for browser validation.
- Screenshots, or a concise visual description when screenshots are not available.
- Findings with severity, reproduction steps, expected result, and actual result.
- Any untested areas or environment limits.

When QA passes, add the `qa-passwd` label. When QA fails, add `qa-failed` and comment with the failure details. Developers should address failed QA findings in a follow-up commit and request another QA pass on the same issue. Merge the PR into `main` only after QA has passed.

## Commit & Pull Request Guidelines

The GitHub repository is `git@github.com:Taskix-AI/Taskix.git`. Use concise, imperative commit subjects, for example `Add workflow retry controls`. Pull requests should link the source issue, summarize the problem and implemented change, list verification commands, report QA issue status, and include screenshots for UI changes.

## Security & Configuration Tips

Keep secrets in `.env` or local settings, never in source files. Common local variables include `APP_BASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CODEX_BIN`, `GITHUB_TOKEN`, `GITHUB_REPO`, and `DATA_DIR`. Do not commit generated SQLite files, SSH keys, Codex session data, or other contents from `data/`.
