# Gitdex

Gitdex 是一个本地优先的控制台，用来让 Codex 驱动的软件团队围绕 GitHub issue 和 pull request 工作。

它把一个产品需求转换成由固定 AI 角色协作的交付流程：

- 产品经理：和用户澄清需求，并输出交接内容。
- Planner：把已确认需求拆成 GitHub issue，并明确 ownership、依赖和验收标准。
- 开发：一次处理一个 GitHub issue，并遵守明确的 owned paths。
- QA：按照 issue 需求和验收标准验证 PR。
- Reviewer：在 QA 通过后审核实现和合并就绪状态。
- Merge agent：合并已批准 PR，并关闭 GitHub issue。
- DevOps：处理部署规划、发布运维和上线后的问题跟进。

Gitdex 使用本地 `codex` CLI、本地 `gh` CLI、GitHub issues/PRs/labels，以及本地 SQLite 状态。它的设计原则是让后端保持确定性：服务端负责任务排队、上下文传递、状态存储和 GitHub 同步；需要判断的工作交给 Codex agent。

## 当前能力

- Next.js 16 Web Console 和 API 服务。
- 首次运行的 admin 设置，以及受登录保护的控制台。
- 绑定 GitHub 仓库的项目管理。
- 本地 SQLite 存储，路径为 `data/gitdex.sqlite`。
- 通过 `gh` 支持每个项目独立设置 GitHub owner/repo、仓库发现、issue 创建、PR 查找、label、comment、review 和 merge。
- Codex CLI 状态检查和长生命周期 agent session。
- PM、Planner、Developer、QA、Reviewer、Merge、Architect blocker-resolution 和 DevOps session，支持持久聊天和 execution log。
- PM 结构化 handoff，用来创建需求记录。
- 需求编号，例如 `R1`、`R2`、`R3`。
- Planner 拆分 issue，并明确 developer role、owned paths、acceptance criteria 和基于 issue 编号的依赖。
- 进入 GitHub 后，以 GitHub issue 作为主要跟踪对象。
- 开发 worktree 隔离，位于 `data/gitdex-workspaces/`。
- 开发 PR 创建/恢复，以及 QA 失败后的重试。
- QA 验证、评论和 GitHub issue 上的 `gd:*` 阶段标签。
- 合并前的 Reviewer 代码审核。
- QA 和 review 通过后的 Merge 任务。
- Developer 或 QA 可把规格阻塞交给 Architect。
- Auto Run：对当前 issue 列表持续运行所有可运行阶段，依赖允许时可以并行。
- Auto Run 暂停、停止、恢复，并在刷新页面后保持状态。
- 每个 issue 的操作按钮：`Run Dev`、`Run QA`、`Run Review`、`Run Merge`。
- 聊天窗口实时显示 job 状态和 Codex 输出。
- GitHub sync 和 triage 视图。
- Self-update UI，可拉取/构建最新 Gitdex 代码，并在配置后请求服务重启。
- 可选 Telegram PM 入口。

## 工作流模型

Gitdex 把工作分成三个阶段。

### 1. 进入 GitHub 前的需求阶段

用户和 PM 对话，直到需求足够清晰，可以进入规划。PM 应一次只问一个聚焦问题，并在需要澄清时提供简洁选项。

PM 输出结构化 handoff JSON，包含：

- 已确认的需求，
- 约束，
- 验收标准，
- 如有必要，未决问题。

Gitdex 会把它记录为一个需求。新的需求可以随时进入系统，不需要等待已有需求完成；多个 workflow 可以并行存在。

### 2. GitHub Issue 跟踪阶段

Planner 收到已确认需求后，GitHub 成为执行跟踪的主体。

Planner 会创建一个或多个 GitHub issue。每个 issue 应包含：

- 清晰的标题和需求，
- 验收标准，
- developer role，
- owned paths，
- 使用 GitHub issue 编号表达的依赖，
- 哪些工作可并行，哪些必须等待前置 issue。

每个 issue 在这些角色阶段中流转：

```text
Run Dev -> Run QA -> Run Review -> Run Merge -> done
```

规则：

- 开发实现需求，并创建或更新 PR。
- QA 验证 PR。QA 失败时，issue 回到开发。
- QA 或开发如果发现 issue 无法在当前规格下安全实现或验证，可以标记为 specification blocked。
- 架构师通过更新 issue scope、acceptance criteria 或 owned paths 解决规格阻塞，然后排队让开发重试。
- QA 通过后，Reviewer 进行代码审核。
- 只有 QA 通过且 Reviewer 标记 ready 后，Merge agent 才合并。
- 后端不直接处理冲突解决或代码判断；这些决策交给 Codex agent。

### 3. GitHub 后的运营阶段

Issue 合并后，DevOps 负责部署和运营跟进：

- 部署设置，
- 发布自动化，
- 回滚规划，
- 故障分析，
- 线上问题跟进。

如果运营中发现新的产品或实现工作，DevOps 应交回给 Architect 或 Planner，由其开新 GitHub issue，重新进入 GitHub issue 跟踪阶段。

## Web Console

项目页面采用类似 ChatGPT 的布局：左侧 workspace sidebar，右侧主聊天/内容区域。

左侧栏围绕需求和对应 GitHub issue 组织：

- New Requirement：开始或继续 PM 需求聊天。
- Requirements：最近需求聊天、状态、归档，以及查看全部需求的入口。
- GitHub Issues：选中需求下的活跃 issue 列表、issue labels、PR 链接、操作按钮和 Auto Run。
- Project tools：GitHub triage、settings、project details 和 Add Project。

GitHub issue 列表中的 badge 以 GitHub labels 为准。本地执行状态，例如正在运行的 Codex job，只影响按钮和实时状态，不被当成 GitHub label 显示。

Issue 操作保持简单：

- `Run Dev`
- `Run QA`
- `Run Review`
- `Run Merge`

`Auto Run` 会运行当前可见 issue 列表中所有可运行的工作。它可以同时推进不同 issue 的不同阶段，例如一个 issue 在 Dev，另一个 issue 在 Review，只要依赖允许即可。Auto Run 可以暂停、停止和恢复。用户手动把 blocked issue 交给架构师时，Auto Run 会暂停，避免自动流程在人工接管时继续推进。

聊天窗口会显示 agent 消息、job 状态、运行时长和实时 Codex 输出。已结束的 job 会保留 execution log。

## GitHub Labels

Gitdex 创建和读取 labels，用于表示持久的 GitHub 工作流状态。

常见状态标签：

```text
gd:dev
gd:fix
gd:rebase
gd:qa
gd:review
gd:merge
gd:architect
gd:blocked
gd:done
```

一个活跃 GitHub issue 应只有一个 `gd:*` 阶段标签。UI 根据这个阶段决定可见操作：

```text
gd:dev       -> Run Dev
gd:fix       -> Run Dev
gd:rebase    -> Run Dev
gd:qa        -> Run QA
gd:review    -> Run Review
gd:merge     -> Run Merge
gd:architect -> Run Architect
gd:blocked   -> Resolve
gd:done      -> no run action
```

旧工作流标签，例如 `gitdex:need-qa`、`gitdex:qa-passed`、`gitdex:qa-failed` 和 `gitdex:ready-to-merge`，现在只作为 legacy label 处理。Gitdex 会在 sync/repair 时迁移或移除它们，让 issue label 状态回到单一 `gd:*` 阶段标签。

常见角色标签：

```text
role:backend_developer
role:web_developer
role:app_developer
role:admin_developer
role:devops_developer
role:data_developer
role:general_developer
```

Labels 应通过 Gitdex 修改，或者由理解工作流的操作人员手动修改。UI 把 GitHub labels 作为可见 badge 来源；本地 job 状态只控制按钮 loading 和实时执行状态。

## 架构

```text
src/app/          Next.js 页面和 API routes
src/components/   Web UI 组件
src/lib/          Codex、GitHub、workflow、storage、auth、settings 和 job 逻辑
scripts/          Node 测试套件
data/             本地运行时状态，git 忽略
```

重要运行时文件：

```text
data/gitdex.sqlite              SQLite 运行时数据库
data/gitdex-workspaces/         每个 agent 的 Git worktree
```

## 运行要求

- 支持 `node:sqlite` 的 Node.js。
- npm。
- 已认证的 GitHub CLI：

```bash
gh auth status
```

- 已认证的 Codex CLI：

```bash
codex --version
codex login
```

Gitdex 要求宿主机上的 `codex exec` 和 `gh` 操作可以正常工作。

产品站点：<https://gitdex.ai>

## 安装

快速安装：

```bash
curl -fsSL https://raw.githubusercontent.com/Gitdex-AI/gitdex/v0.2.0/scripts/install.sh | bash
```

安装脚本会把 Gitdex 安装到 `~/.gitdex/app`，把 `gitdex` 命令链接到 `~/.local/bin`，安装依赖并构建应用。可以用 `GITDEX_INSTALL_DIR` 修改安装目录，用 `GITDEX_BIN_DIR` 修改命令目录。

如果希望安装时直接作为后台服务启动：

```bash
curl -fsSL https://raw.githubusercontent.com/Gitdex-AI/gitdex/v0.2.0/scripts/install.sh | GITDEX_INSTALL_SERVICE=1 bash
```

克隆仓库：

```bash
git clone git@github.com:Gitdex-AI/gitdex.git
cd Gitdex
```

安装依赖：

```bash
npm install
```

启动开发服务：

```bash
gitdex dev
```

打开：

```text
http://127.0.0.1:8000
```

开发服务绑定到 `127.0.0.1:8000`。

常用 CLI 命令：

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

`gitdex install-service` 会安装用户级服务。macOS 写入 `~/Library/LaunchAgents/ai.gitdex.next.plist`，Linux 写入 `~/.config/systemd/user/gitdex.service`。服务日志保存在 `data/logs/`。

## 配置

大部分设置可以在 Web Console 中完成。

常用环境变量：

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

`data/` 是本地运行时状态，不能提交到 git。

## 项目设置

1. 打开 Settings，验证 Codex 和 GitHub CLI 状态。
2. 创建项目，并为该项目输入 GitHub owner 或 organization。
3. 从该 owner 的仓库列表中选择 repository。
4. 如有需要，允许 Gitdex 更新仓库中的 `AGENTS.md` workflow 区块。
5. 打开项目页面，从 PM 聊天开始。

Gitdex 会保留 `AGENTS.md` 中托管区块以外的内容。

## 开发

运行自动化测试：

```bash
npm test
```

运行类型检查：

```bash
npm run typecheck
```

构建：

```bash
npm run build
```

启动生产服务：

```bash
npm start
```

运行聚焦的 issue-run 策略测试：

```bash
npm run test:issue-run
```

## 安全说明

不要提交本地运行时数据。

被忽略或敏感的本地数据包括：

```text
data/
node_modules/
.next/
.env
.env.local
```

`data/` 可能包含：

- SQLite workflow 状态，
- Codex session 数据，
- GitHub SSH 私钥，
- 缓存的工具状态，
- 本地 Git worktrees，
- 项目和 workflow 历史。

请把它视为敏感数据。

## Telegram

Telegram 是可选功能，主要把消息路由到当前项目的 PM session。

配置：

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
APP_BASE_URL=
```

注册 webhook：

```bash
curl http://127.0.0.1:8000/api/setup/webhook
```

命令：

```text
/start
/projects
/use <project_slug>
/current
/status <workflow_id>
```

## License

尚未声明 License。
