# Gitdex Memory

## Product

Gitdex is a local-first control plane for running Codex-powered software delivery teams against GitHub issues and pull requests. It turns product requests into tracked delivery flows handled by fixed AI roles: PM, Architect, Developer, QA, Reviewer/Architect review, and DevOps.

The product intentionally keeps orchestration deterministic: the server stores state, queues jobs, passes context, syncs GitHub, and records logs; Codex agents make requirement, implementation, validation, review, and operational judgments.

Gitdex is a Next.js 16 TypeScript web console plus API server backed by local SQLite state and local CLI integrations.

## Users

Primary users are operators or product owners who want to drive AI-assisted software work through GitHub with visible checkpoints.

PM users clarify requirements and create structured handoffs. Architect users split requirements into scoped GitHub issues, define dependencies and owned paths, resolve blockers, and decide merge readiness. Developer agents implement issue-scoped changes. QA agents independently validate PRs against issue requirements. DevOps agents handle deployment planning, release operations, rollback, and production follow-up.

## UX Model

The console has authenticated setup/login, a dashboard, project pages, settings, and tools/status pages. Project setup binds a local Gitdex project to a GitHub repo and can update the repo's managed `AGENTS.md` workflow block.

The main project page centers on a chat surface plus a right-side workflow panel. Chat shows agent messages, job status, elapsed time, and live Codex output; completed jobs retain logs.

The workflow panel is phase-oriented: Requirements, GitHub Issues, and Operations. GitHub issue rows show durable GitHub labels as badges, PR links, stage/action controls, and local running state. Common actions are intentionally small: `Run Dev`, `Run QA`, `Run Review`, `Run Merge`, plus Auto Run controls.

Settings and tools expose local Codex and GitHub CLI status. Optional Telegram support routes messages into the selected project's PM session.

## Workflow Model

Work begins in PM chat before GitHub tracking. The PM produces structured handoff JSON with confirmed requirement, constraints, acceptance criteria, and open questions. Gitdex records the requirement using IDs such as `WF-YYYYMMDD-NNN`.

The Architect turns requirements into one or more GitHub issues. Each issue should include title, requirement, acceptance criteria, developer role, owned paths, dependencies by GitHub issue number, and parallelization guidance.

Issue execution follows `Run Dev -> Run QA -> Run Review -> Run Merge -> done`. Developers implement and open or update PRs. QA validates independently and comments evidence. Failed QA sends the issue back to Developer. Developer or QA can escalate specification blockers to Architect.

Architect resolves specification blockers by updating scope, acceptance criteria, or owned paths, then queues retry. Architect review happens after QA passes. Merge readiness requires QA pass plus Architect review pass.

Auto Run advances currently runnable issue stages, including parallel work when dependencies allow it. Manual escalation to Architect pauses Auto Run. Auto Run state persists across refreshes and supports pause, stop, and resume.

After merge, DevOps owns deployment setup, release automation, rollback planning, incident analysis, and production follow-up. Operational discoveries that require product or code changes go back to Architect as new GitHub issues.

## Domain Terms

Project: a local Gitdex workspace bound to a GitHub repository.

Requirement: a PM-confirmed product request recorded before issue planning, commonly identified as `WF-YYYYMMDD-NNN`.

Handoff: structured PM output used by Architect to plan GitHub issues.

Owned paths: file or directory boundaries assigned to a developer issue; they are central to parallel work and merge safety.

Developer role: issue metadata describing the expected implementation specialty, such as backend, web, app, admin, DevOps, data, or general developer.

Specification blocker: a state where Developer or QA cannot safely proceed without Architect clarification.

Issue stage: derived workflow position for a GitHub issue, based on labels, PR state, QA status, review state, dependencies, and local job state.

Auto Run: project-level automation that starts the next runnable role job for visible issues.

QA evidence: issue comment recording commands, automated tests, manual browser scenarios, observed results, findings, and environment limits.

## Design Decisions

GitHub issues and PRs are the durable execution source after planning; Gitdex local state augments GitHub with job runtime, logs, sessions, worktrees, and UI state.

GitHub labels are the visible durable workflow badges. Local running state should affect buttons and live status rather than being represented as durable labels.

Role separation is deliberate. QA is an independent validator, not a code co-author. Architect controls issue breakdown, blocker resolution, review, and merge readiness.

Developer work is isolated in per-issue worktrees under local runtime data. Developers should work from issue branches and PRs rather than committing feature work directly to `main`.

The backend should not hand-roll code judgment, conflict resolution, or product decisions. It orchestrates deterministic transitions and delegates judgment to the correct agent role.

Self-update is exposed in the UI and may pull/build latest Gitdex code and request a configured service restart.

## Constraints

Gitdex expects local `codex` and `gh` CLIs to be installed and authenticated. `codex exec` and GitHub operations must work on the host machine.

Runtime state is local and sensitive: SQLite database, Codex sessions, generated GitHub SSH keys, cached status, local worktrees, and workflow history live under `data/` and must not be committed.

The default local server binds to `127.0.0.1:8000`. QA preview servers should use isolated `DATA_DIR` directories and alternate ports when needed.

Automatic deployment is disabled unless explicitly approved or enabled by DevOps. Current deployment posture is manual/no-deploy unless a DevOps workflow changes it.

The repository license is not declared yet.

## Recent Context

Current repo memory was initialized from the local workspace for `Gitdex-AI/gitdex`.

The active documented smoke context references a local no-deploy main-flow validation for issue `#23` / PR `#24`, using `npm run typecheck`, `npm run build`, `npm run dev`, and a manual browser pass at `http://127.0.0.1:8000`.

A planning-only safe smoke recheck for issue `#32` is documented as no-deploy and stops after planning; any `issue_run` jobs are queued only for later manual execution.

Future product discussions should preserve the current operating model: PM clarifies with the user, Architect plans GitHub issues with dependencies and owned paths, Developers implement scoped PRs, QA validates before merge, Architect merges after QA/review pass, and DevOps owns deployment/release concerns.
