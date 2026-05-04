# Gitdex

Gitdex is a local-first control plane for running Codex-powered software teams against GitHub issues and pull requests.

It turns a product request into a tracked delivery flow with fixed AI roles:

- Product Manager: clarifies requirements with the user and produces a handoff.
- Architect: turns requirements into GitHub issues, reviews implementation, resolves specification blockers, and controls merge readiness.
- Developer: implements one GitHub issue at a time inside explicit owned paths.
- QA: validates pull requests against issue requirements and acceptance criteria.
- DevOps: handles deployment planning, release operations, and production follow-up.

Gitdex uses the local `codex` CLI, the local `gh` CLI, GitHub issues/PRs/labels, and local SQLite state. It is designed to keep the backend deterministic: the server queues work, passes context between agents, stores state, and syncs GitHub; agents make the judgment calls.

## Current Capabilities

- Next.js 16 web console and API server.
- First-run admin setup and login-protected console.
- Project setup bound to a GitHub repository.
- Local SQLite storage in `data/gitdex.sqlite`.
- GitHub account setup, SSH key generation, repo discovery, issue creation, PR lookup, labels, comments, review, and merge operations through `gh`.
- Codex CLI status checks and long-running agent sessions.
- PM, Architect, Developer, QA, and DevOps sessions with persistent chat and execution logs.
- Structured PM handoff to create a requirement record.
- Requirement IDs such as `WF-YYYYMMDD-NNN`.
- Architect issue planning with explicit developer roles, owned paths, acceptance criteria, and issue-number dependencies.
- GitHub issue tracking as the main execution object after planning.
- Developer worktree isolation under `data/gitdex-workspaces/`.
- Developer PR creation/recovery and retry after failed QA.
- QA validation with comments and `gitdex:qa-*` labels.
- Architect code review before merge.
- Architect merge jobs after QA and review pass.
- Specification blocker escalation back to Architect from Developer or QA.
- Auto Run for issue lists: Gitdex keeps running any currently runnable issue stage, including parallel work where dependencies allow it.
- Auto Run pause, stop, resume, and persisted state across refreshes.
- Per-issue controls: `Run Dev`, `Run QA`, `Run Review`, and `Run Merge`.
- Live job status and Codex output in the chat window.
- GitHub sync and triage views.
- Self-update UI for pulling/building the latest Gitdex code and requesting a service restart when configured.
- Optional Telegram PM entry point.

## Workflow Model

Gitdex separates work into three phases.

### 1. Requirements Before GitHub

The user talks with the PM until the requirement is clear enough to hand over.

The PM produces structured handoff JSON with:

- the confirmed requirement,
- constraints,
- acceptance criteria,
- open questions, if any.

Gitdex records this as a requirement. Requirements may be created while other requirements are still running; workflows are not assumed to be serial.

### 2. GitHub Issue Tracking

After the Architect receives a requirement, GitHub becomes the source of execution tracking.

The Architect creates one or more GitHub issues. Each issue should include:

- a clear title and requirement,
- acceptance criteria,
- developer role,
- owned paths,
- dependencies by GitHub issue number,
- whether work can run in parallel or must wait for another issue.

Each issue then moves through these role-owned stages:

```text
Run Dev -> Run QA -> Run Review -> Run Merge -> done
```

Rules:

- Developer implements and opens or updates a PR.
- QA validates the PR. If QA fails, the issue returns to Developer.
- QA or Developer may mark an issue as specification-blocked when the issue cannot be safely implemented or validated without Architect clarification.
- Architect resolves specification blockers by updating issue scope, acceptance criteria, or owned paths, then queues Developer retry.
- Architect reviews code after QA passes.
- Architect merges only after QA passes and review marks the PR ready.
- The backend does not hand-roll conflict resolution or code judgment; those decisions are delegated to Codex agents.

### 3. Post-GitHub Operations

After issues are merged, DevOps owns deployment and operational follow-up:

- deployment setup,
- release automation,
- rollback planning,
- incident analysis,
- production follow-up.

If operations uncover product or implementation work, DevOps should hand it back to Architect so a new GitHub issue can enter the normal issue-tracking phase.

## Web Console

The project page is split into the chat surface and a right-side workflow panel.

The right-side panel is organized by phase:

- Requirements: recent requirements and the entry to all requirements.
- GitHub Issues: active issue list, issue labels, PR links, action buttons, and Auto Run.
- Operations: DevOps and post-merge work.

The GitHub issue list shows GitHub-backed labels as labels. Local execution state, such as a currently running Codex job, affects buttons and live status instead of being treated as a GitHub label.

Issue actions are intentionally small:

- `Run Dev`
- `Run QA`
- `Run Review`
- `Run Merge`

`Auto Run` runs whatever is currently runnable in the visible issue list. It can advance different issues in different stages at the same time, for example one issue in Dev and another in Review, as long as dependencies allow it. Auto Run can be paused, stopped, and resumed. Manual escalation to Architect pauses Auto Run so the user can take over a blocked flow without automatic work continuing underneath.

The chat window shows agent messages, job status, elapsed time, and live Codex output. Finished jobs retain execution logs.

## GitHub Labels

Gitdex creates and reads labels for durable GitHub workflow state.

Common state labels:

```text
gitdex:dev-running
gitdex:architect-review
gitdex:need-qa
gitdex:qa-running
gitdex:qa-passed
gitdex:qa-failed
gitdex:spec-blocked
gitdex:ready-to-merge
gitdex:merged
gitdex:deployed
gitdex:blocked
gitdex:superseded
```

Common role labels:

```text
role:backend_developer
role:web_developer
role:app_developer
role:admin_developer
role:devops_developer
role:data_developer
role:general_developer
```

Labels should be changed through Gitdex or by an operator who understands the workflow. The UI treats GitHub labels as the visible badge source, while local job state controls button loading and live execution status.

## Architecture

```text
src/app/          Next.js pages and API routes
src/components/   Web UI components
src/lib/          Codex, GitHub, workflow, storage, auth, settings, and job logic
scripts/          Node test suite
data/             Local runtime state, ignored by git
```

Important runtime files:

```text
data/gitdex.sqlite              SQLite runtime database
data/gitdex-workspaces/         per-agent Git worktrees
data/ssh/                       generated GitHub SSH keys
```

## Requirements

- Node.js with `node:sqlite` support.
- npm.
- Authenticated GitHub CLI:

```bash
gh auth status
```

- Authenticated Codex CLI:

```bash
codex --version
codex login
```

Gitdex expects `codex exec` and `gh` operations to work on the host machine.

## Installation

Quick install:

```bash
curl -fsSL https://raw.githubusercontent.com/Gitdex-AI/gitdex/main/scripts/install.sh | bash
```

The script installs Gitdex into `~/.gitdex/app`, links `gitdex` into `~/.local/bin`, installs dependencies, and builds the app. The install location can be changed with `GITDEX_INSTALL_DIR`, and the command directory can be changed with `GITDEX_BIN_DIR`.

To install and start Gitdex as a background service during installation:

```bash
curl -fsSL https://raw.githubusercontent.com/Gitdex-AI/gitdex/main/scripts/install.sh | GITDEX_INSTALL_SERVICE=1 bash
```

Clone the repository:

```bash
git clone git@github.com:Gitdex-AI/gitdex.git
cd Gitdex
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
gitdex dev
```

Open:

```text
http://127.0.0.1:8000
```

The dev server binds to `127.0.0.1:8000`.

Useful CLI commands:

```bash
gitdex doctor
gitdex dev
gitdex build
gitdex start
gitdex update
gitdex status
gitdex install-service
gitdex service-status
gitdex service-logs
gitdex uninstall-service
```

`gitdex install-service` installs a per-user service. On macOS it writes `~/Library/LaunchAgents/ai.gitdex.next.plist`; on Linux it writes `~/.config/systemd/user/gitdex.service`. Service logs are stored under `data/logs/`.

## Configuration

Most settings are configured in the web console.

Useful environment variables:

```bash
APP_BASE_URL=http://127.0.0.1:8000
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

CODEX_BIN=codex
CODEX_MODEL=gpt-5.4
CODEX_SANDBOX=workspace-write
CODEX_APPROVAL_POLICY=never

GITHUB_TOKEN=
GITHUB_REPO=owner/repo
GITHUB_API_URL=https://api.github.com
DATA_DIR=./data

GITDEX_ENABLE_SELF_UPDATE=true
GITDEX_NEXT_SERVICE_MANAGER=pm2
GITDEX_NEXT_SERVICE_NAME=gitdex-next
```

`data/` is local runtime state and must not be committed.

## Project Setup

1. Open Settings and verify Codex and GitHub CLI status.
2. Create a project and enter the GitHub owner or organization for that project.
3. Select the repository from the owner-specific repository list.
4. Let Gitdex update the repo's `AGENTS.md` workflow section if desired.
5. Open the project page and start from the PM chat.

Gitdex preserves content outside its managed `AGENTS.md` block.

## Development

Run the automated test suite:

```bash
npm test
```

Run type checks:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Start the production server:

```bash
npm start
```

Focused issue-run policy test:

```bash
npm run test:issue-run
```

## Security Notes

Do not commit local runtime data.

Ignored or sensitive local data includes:

```text
data/
node_modules/
.next/
.env
.env.local
```

`data/` may contain:

- SQLite workflow state,
- Codex session data,
- GitHub SSH private keys,
- cached tool status,
- local Git worktrees,
- project and workflow history.

Treat it as sensitive.

## Telegram

Telegram support is optional and primarily routes messages into the selected project's PM session.

Configure:

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
APP_BASE_URL=
```

Register the webhook:

```bash
curl http://127.0.0.1:8000/api/setup/webhook
```

Commands:

```text
/start
/projects
/use <project_slug>
/current
/status <workflow_id>
```

## License

License is not declared yet.
