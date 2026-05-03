import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { developerRoleIds, developerRoleProfile, formatDeveloperRoleCatalog } from "@/lib/developer-roles";
import { expectedDeveloperBaseBranch } from "@/lib/issue-run-policy";
import { getActiveJobId } from "@/lib/job-runtime";
import { touchJobRuntime } from "@/lib/store";
import type { ArchitectPrReviewResult, ArchitectReviewResult, DeveloperIssueResult, DeveloperResult, IssueSpec, QaPrReviewResult, QaResult } from "@/lib/types";
import { dataDir, rootDir } from "@/lib/paths";
import type { Settings } from "@/lib/types";

type CodexTextResult = { text: string; sessionId?: string | null; executionLog?: string };
type RunJsonOptions = { cwd?: string };
type RunTextOptions = { cwd?: string };
type RunCodexOptions = { cwd?: string };
type DeveloperWorktreeFacts = {
  expectedBranch: string;
  activePrBranch: string | null;
  activePrHead: string | null;
  activePrBase: string | null;
  currentBranch: string | null;
  currentHead: string | null;
  baseBranch: string;
  baseHead: string | null;
  statusShort: string;
  diffNameStatus: string;
  diffAgainstActiveBranch: string;
  fetchSummary: string;
};
const execFileAsync = promisify(execFile);
const codexTimeoutMs = 10 * 60 * 1000;
const ansiPattern = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function normalizeRuntimeOutput(chunk: Buffer | string): string {
  return String(chunk).replace(ansiPattern, "");
}

function formatDeveloperWorktreeFacts(facts: DeveloperWorktreeFacts): string {
  return [
    `- expectedBranch: ${facts.expectedBranch}`,
    `- activePrBranch: ${facts.activePrBranch ?? "none"}`,
    `- activePrHead: ${facts.activePrHead ?? "unknown"}`,
    `- activePrBase: ${facts.activePrBase ?? "unknown"}`,
    `- currentBranch: ${facts.currentBranch ?? "unknown"}`,
    `- currentHead: ${facts.currentHead ?? "unknown"}`,
    `- baseBranch: ${facts.baseBranch}`,
    `- baseHead: ${facts.baseHead ?? "unknown"}`,
    `- fetchSummary:\n${indentFact(facts.fetchSummary || "ok")}`,
    `- git status --short --branch:\n${indentFact(facts.statusShort || "clean or unavailable")}`,
    `- git diff --name-status:\n${indentFact(facts.diffNameStatus || "none")}`,
    `- git diff --name-status origin/activePrBranch:\n${indentFact(facts.diffAgainstActiveBranch || "none or no active PR branch")}`
  ].join("\n");
}

function indentFact(value: string): string {
  return value.trim() ? value.trim().split("\n").map((line) => `  ${line}`).join("\n") : "  none";
}

function oneLine(value: string): string | null {
  const line = value.trim().split("\n").find(Boolean)?.trim();
  return line || null;
}

async function gitFact(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args]);
    return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(0, 6000);
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 6000) : String(error).slice(0, 6000);
  }
}

async function ghJsonFact<T>(cwd: string, args: string[]): Promise<T | null> {
  try {
    const { stdout } = await execFileAsync("gh", args, { cwd });
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

export type ArchitectBlockerResolution = {
  action: "retry_developer" | "request_user_input" | "mark_blocked";
  summary: string;
  issueTitle: string;
  issueDescription: string;
  developerRole: string;
  ownedPaths: string[];
  acceptanceCriteria: string[];
  comment: string;
  executionLog?: string;
};

const rolePrompts = {
  product_manager:
    "You are a Codex product manager. Stay available for user conversation, clarify requirements, and only hand confirmed requirements to the planner. Do not perform long-running implementation work.",
  planner:
    "You are a Codex planner. Turn confirmed product requirements into GitHub-tracked implementation issues, define dependencies, assign developer roles, and set ownedPaths. Do not implement, QA, review PRs, merge, or deploy.",
  developer:
    "You are a Codex developer. Work only within the directories assigned by the planner or issue architect, keep ownership boundaries clear, and avoid touching files owned by other parallel developers.",
  qa:
    "You are a Codex QA engineer. Validate implementation against acceptance criteria, identify defects and regressions, and create follow-up issues for fixes. Do not decide merge or deployment.",
  architect:
    "You are a Codex issue architect. Resolve unclear, contradictory, or technically non-executable issue specifications so developer work can continue. Do not implement, QA, merge, or deploy.",
  reviewer:
    "You are a Codex reviewer. Review QA-passed PRs for merge readiness and handle the dedicated merge step. Do not plan requirements, implement developer work, QA, or deploy.",
  devops:
    "You are a Codex DevOps engineer. Own deployment setup, GitHub Actions/CD pipelines, environment/secrets guidance, release automation, observability, and rollback planning. Do not decompose product features."
} as const;

export class CodexClient {
  constructor(private readonly settings: Settings) {}

  async projectManagerChat(input: {
    projectName: string;
    githubRepo: string;
    message: string;
    sessionId?: string | null;
  }): Promise<CodexTextResult> {
    const prompt = `${rolePrompts.product_manager}

Project: ${input.projectName}
GitHub repo: ${input.githubRepo}

Conversation rules:
- Reply in natural language while clarifying or restating requirements.
- When the user explicitly confirms the requirement is correct or asks to proceed, output a short natural-language sentence, then include one JSON object in a fenced code block.
- The JSON object must use this exact shape:
{
  "status": "ready_for_architect",
  "requirement": "clear implementation requirement",
  "constraints": ["constraint or assumption"],
  "acceptanceCriteria": ["testable acceptance criterion"],
  "openQuestions": []
}
- Only set status to "ready_for_architect" when no blocking open questions remain.
- If there are still open questions, do not output JSON.

User message:
${input.message}`;
    const result = await this.runText(prompt, input.sessionId);
    return (
      result ?? {
        text: "PM mock response: I captured the requirement. Use /confirm <requirement> when the scope is ready for planner handoff.",
        sessionId: input.sessionId
      }
    );
  }

  async architectChat(input: {
    projectName: string;
    githubRepo: string;
    message: string;
    sessionId?: string | null;
  }): Promise<CodexTextResult> {
    const workspaceDir = await this.prepareArchitectWorkspace(input.githubRepo, input.projectName);
    const prompt = `${rolePrompts.architect}

Project: ${input.projectName}
GitHub repo: ${input.githubRepo}
Workspace: ${workspaceDir}

Hard rules:
- Do not modify the current Taskix app checkout or its .git directory.
- The current working directory is the isolated architect clone: ${workspaceDir}.
- Run git and gh commands only in the current working directory unless explicitly inspecting GitHub metadata with gh.

User message:
${input.message}`;
    const result = await this.runText(prompt, input.sessionId, { cwd: workspaceDir });
    return (
      result ?? {
        text: "Architect mock response: I captured this project context and can review architecture, issue ownership, merge readiness, and deployment strategy.",
        sessionId: input.sessionId
      }
    );
  }

  async reviewerChat(input: {
    projectName: string;
    githubRepo: string;
    message: string;
    sessionId?: string | null;
  }): Promise<CodexTextResult> {
    const workspaceDir = await this.prepareArchitectWorkspace(input.githubRepo, `reviewer-${input.projectName}`);
    const prompt = `${rolePrompts.reviewer}

Project: ${input.projectName}
GitHub repo: ${input.githubRepo}
Workspace: ${workspaceDir}

Hard rules:
- Do not modify the current Taskix app checkout or its .git directory.
- The current working directory is the isolated reviewer clone: ${workspaceDir}.
- Run git and gh commands only in the current working directory unless explicitly inspecting GitHub metadata with gh.

User message:
${input.message}`;
    const result = await this.runText(prompt, input.sessionId, { cwd: workspaceDir });
    return (
      result ?? {
        text: "Reviewer mock response: I checked merge readiness and recorded the requested merge handling.",
        sessionId: input.sessionId
      }
    );
  }

  async architectResolveBlocker(input: {
    projectName: string;
    githubRepo: string;
    blockedContext: string;
    sessionId?: string | null;
  }): Promise<{ resolution: ArchitectBlockerResolution; sessionId?: string | null }> {
    const workspaceDir = await this.prepareArchitectWorkspace(input.githubRepo, input.projectName);
    const schema = objectSchema({
      action: { type: "string", enum: ["retry_developer", "request_user_input", "mark_blocked"] },
      summary: { type: "string" },
      issueTitle: { type: "string" },
      issueDescription: { type: "string" },
      developerRole: { type: "string" },
      ownedPaths: { type: "array", items: { type: "string" } },
      acceptanceCriteria: { type: "array", items: { type: "string" } },
      comment: { type: "string" }
    });
    const prompt = `${rolePrompts.architect}

Project: ${input.projectName}
GitHub repo: ${input.githubRepo}
Workspace: ${workspaceDir}

You are resolving a blocked Taskix workflow, not just giving advice.

Resolution rules:
- QA may send two different blocked states: implementation failure goes back to developer; spec or architecture blocker comes to you. If QA identified missing, contradictory, or technically non-executable acceptance criteria, update the issue criteria before retrying developer.
- If the blocker can be fixed by narrowing scope, correcting ownedPaths, or making acceptance criteria executable, return action "retry_developer".
- For retry_developer, return a complete revised issue title, description, ownedPaths, developerRole, and acceptanceCriteria that a developer can execute immediately.
- If the blocker needs a user decision that cannot be inferred, return action "request_user_input" and put the exact question in comment.
- Only return action "mark_blocked" if the issue cannot proceed safely.
- Do not return general advice. Return a concrete executable resolution.
- Do not modify the current Taskix app checkout or its .git directory.
- The current working directory is the isolated architect clone: ${workspaceDir}.
- Run git and gh commands only in the current working directory unless explicitly inspecting GitHub metadata with gh.

Blocked context:
${input.blockedContext}`;

    const result = await this.runJsonResult<ArchitectBlockerResolution>(prompt, schema, { cwd: workspaceDir });
    const resolution = result.value;
    return {
      resolution: resolution ? { ...resolution, executionLog: result.executionLog } : {
        action: "request_user_input",
        summary: "Architect could not produce a structured blocker resolution.",
        issueTitle: "",
        issueDescription: "",
        developerRole: "general_developer",
        ownedPaths: [],
        acceptanceCriteria: [],
        comment: "Please clarify the implementation scope and valid owned paths before retrying the developer.",
        executionLog: result.executionLog
      },
      sessionId: input.sessionId
    };
  }

  async devopsChat(input: {
    projectName: string;
    githubRepo: string;
    message: string;
    sessionId?: string | null;
  }): Promise<CodexTextResult> {
    const prompt = `${rolePrompts.devops}

Project: ${input.projectName}
GitHub repo: ${input.githubRepo}

Conversation rules:
- Discuss deployment/CD setup with the user in natural language.
- Clarify provider, branches, environments, secrets, build commands, deploy commands, rollback, and deployment approval rules.
- When CD setup is confirmed, output a short natural-language sentence, then include one JSON object in a fenced code block:
{
  "status": "ready_for_cd_setup",
  "provider": "github_actions",
  "workflowPath": ".github/workflows/taskix-deploy.yml",
  "trigger": { "onPushBranches": ["main"], "manualDispatch": true },
  "environment": "production",
  "requiredSecrets": [],
  "buildCommand": "",
  "deployCommand": "",
  "rollbackPlan": "",
  "openQuestions": []
}
- Only set status to "ready_for_cd_setup" when no blocking open questions remain.

User message:
${input.message}`;
    const result = await this.runText(prompt, input.sessionId);
    return (
      result ?? {
        text: "DevOps mock response: I can help define the GitHub Actions deployment workflow, required secrets, deployment trigger, and rollback plan.",
        sessionId: input.sessionId
      }
    );
  }

  async architectPlanIssues(requirement: string): Promise<IssueSpec[]> {
    const schema = {
      type: "object",
      properties: {
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              assigneeRole: { type: "string", enum: ["developer"] },
              developerRole: { type: "string", enum: developerRoleIds },
              ownedPaths: { type: "array", items: { type: "string" } },
              acceptanceCriteria: { type: "array", items: { type: "string" } },
              dependsOn: { type: "array", items: { type: "string" } },
              parallelGroup: { anyOf: [{ type: "string" }, { type: "null" }] },
              executionOrder: { anyOf: [{ type: "number" }, { type: "null" }] }
            },
            required: ["title", "description", "assigneeRole", "developerRole", "ownedPaths", "acceptanceCriteria", "dependsOn", "parallelGroup", "executionOrder"],
            additionalProperties: false
          }
        }
      },
      required: ["issues"],
      additionalProperties: false
    };
    const prompt = `${rolePrompts.planner}

Confirmed requirement from PM:
${requirement}

Return 2-6 implementation issues as JSON.

Available developerRole catalog:
${formatDeveloperRoleCatalog()}

Rules:
- Decide how many developer roles are needed for this requirement.
- Use assigneeRole="developer" for all implementation issues.
- Set developerRole to exactly one id from the available catalog. Do not invent new role ids.
- Use general_developer only when no specific catalog role fits.
- Set ownedPaths to the repository directories/files this developer owns, for example ["src/app", "src/components"].
- Include directly related automated test files in ownedPaths when acceptance criteria change behavior that existing tests verify, for example ["scripts/header-label.test.mjs"] for a header label change.
- Keep ownedPaths as non-overlapping as possible across issues to reduce code conflicts.
- Each issue should have clear directory ownership and should not require edits outside ownedPaths unless explicitly stated in acceptance criteria.
- Acceptance criteria should make expected test updates explicit when a requirement intentionally changes text, behavior, parsing, routing, labels, or workflow state already covered by tests.
- Mark independent issues with the same parallelGroup when they can run at the same time.
- Set dependsOn to the titles of issues that must complete first. Use [] for issues that can start immediately. Taskix will convert these temporary planning references to GitHub issue numbers after issues are created.
- Set executionOrder to the intended serial order, using the same number for issues that can run in parallel.`;
    const payload = await this.runJson<{ issues: IssueSpec[] }>(prompt, schema);
    return payload?.issues ?? mockIssues();
  }

  async developerOutput(issue: IssueSpec): Promise<DeveloperResult> {
    const ownedPaths = issue.ownedPaths ?? [];
    const schema = objectSchema({
      summary: { type: "string" },
      implementationNotes: { type: "array", items: { type: "string" } },
      prTitle: { type: "string" },
      prBody: { type: "string" }
    });
    const prompt = `${rolePrompts.developer}

Developer role: ${issue.developerRole ?? "developer"}
Role profile:
${developerRoleProfile(issue.developerRole)}

Owned paths:
${ownedPaths.map((item) => `- ${item}`).join("\n")}

Issue title: ${issue.title}
Issue description: ${issue.description}
Acceptance criteria:
${issue.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}

Return JSON with summary, implementationNotes, prTitle, prBody.

Implementation must stay within owned paths unless the issue explicitly calls out a cross-directory integration point. If cross-directory changes are required, state the risk clearly in implementationNotes.`;
    return (
      (await this.runJson<DeveloperResult>(prompt, schema)) ?? {
        summary: `Implemented issue: ${issue.title}`,
        implementationNotes: issue.acceptanceCriteria,
        prTitle: `feat: ${issue.title.toLowerCase()}`,
        prBody: `## Summary\n- ${issue.description}`
      }
    );
  }

  async developerHandleIssue(input: {
    repo: string;
    issueNumber: number;
    issue: IssueSpec;
    workflowId: string;
    activePrUrl?: string | null;
    activeBranch?: string | null;
    returnedFromQa?: boolean | null;
  }): Promise<DeveloperIssueResult> {
    const schema = objectSchema({
      summary: { type: "string" },
      blockedType: { type: "string", enum: ["none", "implementation", "spec", "environment"] },
      branch: { type: "string" },
      prUrl: { type: "string" },
      changedFiles: { type: "array", items: { type: "string" } },
      testsRun: { type: "array", items: { type: "string" } }
    });
    let workspaceDir: string;
    try {
      workspaceDir = await this.prepareDeveloperWorkspace(input.repo, input.workflowId, input.issueNumber);
    } catch (error) {
      return {
        summary: `Developer workspace preparation failed for issue #${input.issueNumber}: ${error instanceof Error ? error.message : String(error)}`,
        blockedType: "environment",
        branch: "",
        prUrl: "",
        changedFiles: [],
        testsRun: []
      };
    }
    const baseBranch = expectedDeveloperBaseBranch();
    const expectedBranch = `taskix/${input.workflowId}-issue-${input.issueNumber}`;
    const worktreeFacts = await this.collectDeveloperWorktreeFacts({
      repo: input.repo,
      workspaceDir,
      baseBranch,
      expectedBranch,
      activeBranch: input.activeBranch ?? null,
      activePrUrl: input.activePrUrl ?? null
    });
    const prompt = `${rolePrompts.developer}

GitHub repo: ${input.repo}
GitHub issue: #${input.issueNumber}
Workspace: ${workspaceDir}
Base branch: ${baseBranch ?? "repository default branch"}
Expected issue branch: ${expectedBranch}
Current active PR: ${input.activePrUrl ?? "none"}
Current active branch: ${input.activeBranch ?? "none"}
Returned from QA: ${input.returnedFromQa ? "yes" : "no"}

System-collected worktree facts:
${formatDeveloperWorktreeFacts(worktreeFacts)}

Before editing:
- First decide whether the worktree is on the correct target branch and whether the dirty state is safe to use.
- If Current active PR is not "none", your target is that active PR branch. You may need to recover or update that branch, but do not implement on an unrelated branch.
- If Current active PR is "none", your target is the expected issue branch.
- Use the system-collected facts as facts, not as instructions to discard or keep changes. You must make the recovery decision from the GitHub issue/PR context.
- If the branch is wrong, the worktree is dirty, or local changes conflict with the active PR branch, explain your recovery decision in the final summary.
- If you cannot safely recover the worktree or cannot write the Git index, return blockedType "environment" with prUrl empty. Do not return blockedType "none" unless you pushed a commit to the active PR branch or created/pushed the expected issue branch.

Task:
- Read issue #${input.issueNumber}, labels, linked PRs, and the full issue/PR comment timeline with gh. Treat GitHub as the source of truth for requirements, ownedPaths, acceptance criteria, dependencies, and prior QA/architect feedback.
- Do not rely only on the latest comment. Understand the whole issue history, including earlier QA failures, QA passes, architect blockers, developer retries, and whether the same requirement is cycling between incompatible fixes.
- Implement or update the active PR according to that GitHub context.
- If QA/architect comments conflict, follow the newest relevant comment and the current Taskix workflow rules. Treat older conflicting QA findings as superseded by newer QA feedback.

Hard rules:
- Do not modify the current Taskix app checkout or its .git directory.
- The current working directory is the isolated clone for this issue: ${workspaceDir}.
- Run git fetch, checkout, commit, and push only in the current working directory.
- Work only inside ownedPaths from the GitHub issue unless an issue comment explicitly revises scope.
- You may also update test files that directly verify this issue's acceptance criteria, even if the architect omitted them from ownedPaths. Keep those test edits minimal and explain the test-scope reason in summary.
- Do not revert a directly related test update merely because an older QA comment called it outside ownedPaths; current Taskix policy allows that narrow test-scope exception.
- If Current active PR is not "none", update that PR branch and return the same PR URL. Do not create a replacement PR unless the existing PR is closed or unusable.
- If Returned from QA is "yes", address QA findings on the current active PR branch and push follow-up commits.
- Do not continue implementation on the wrong branch merely because the code compiles locally.
- When retrying after QA failure, do not patch only the exact reported symptom. Identify the underlying contract behind the QA finding.
- If the QA finding involves a trust boundary, API contract, state machine, permissions model, lifecycle rule, dependency ordering, ownedPaths boundary, data consistency rule, or cross-component interaction, audit analogous paths and update the complete affected workflow.
- Keep this audit scoped to the issue and ownedPaths. "Analogous paths" means paths necessary to satisfy the same contract for this issue, not unrelated broad refactors.
- If the complete contract is not specified well enough to choose a safe fix, stop and return blockedType "spec" with the missing architect decision.
- If there is no active PR, create a branch named taskix/${input.workflowId}-issue-${input.issueNumber} or a similarly unique branch.
- Implement the issue, run relevant tests, commit, and push the branch. Do not run gh pr create.
- Do not add/remove GitHub labels or comments. Taskix server will create/update the PR and labels after you return JSON.
- If implementation is blocked, return JSON with prUrl as an empty string and explain the blocker in summary.
- Before returning any blocked result or making another follow-up fix after QA failed, explicitly decide whether this is developer work or architect work. If the current issue remains executable and the fix is clear, continue as developer. If the problem requires changing or clarifying the issue, return blockedType "spec".
- Set blockedType:
  - "none" when a PR was created or updated.
  - "implementation" when you are blocked by a normal implementation or tooling problem that developer can resolve on retry.
  - "spec" when the GitHub issue is unclear, contradictory, missing required architecture decisions, has unsafe acceptance criteria, has insufficient ownedPaths, or cannot be executed without architect clarification. Do not choose the technical policy yourself in this case.
  - "environment" when local workspace/tooling prevents work from starting or completing.
- Choose "spec" when satisfying one acceptance criterion makes another criterion fail and the issue does not define a trusted signal, policy, dependency, interface, or ownership boundary that distinguishes the cases.
- Choose "spec" when the latest QA/architect comments show repeated back-and-forth between incompatible fixes under the current issue text. Do not keep guessing a policy by changing code.
- For blockedType "spec", do not create a PR. Explain the exact issue or architecture clarification needed so Architect can update the GitHub issue.

Return JSON with summary, blockedType, branch, prUrl, changedFiles, testsRun.`;
    const result = await this.runJsonResult<DeveloperIssueResult>(prompt, schema, { cwd: workspaceDir });
    return result.value ? { ...result.value, executionLog: result.executionLog } : {
      summary: `Developer runner did not complete issue #${input.issueNumber}.${result.error ? `\n\nCodex error:\n${result.error}` : ""}`,
      blockedType: "environment",
      branch: "",
      prUrl: "",
      changedFiles: [],
      testsRun: [],
      executionLog: result.executionLog
    };
  }

  async architectReviewPr(input: {
    repo: string;
    issueNumber: number;
    prUrl: string;
    autoDeploy: boolean;
    qaPassed?: boolean;
  }): Promise<ArchitectPrReviewResult> {
    const schema = objectSchema({
      decision: { type: "string", enum: ["need_qa", "ready_to_merge", "changes_requested", "blocked"] },
      summary: { type: "string" },
      labelsApplied: { type: "array", items: { type: "string" } },
      comments: { type: "array", items: { type: "string" } }
    });
    const prompt = `${rolePrompts.reviewer}

GitHub repo: ${input.repo}
Issue: #${input.issueNumber}
PR: ${input.prUrl}
QA passed: ${input.qaPassed ? "yes" : "no/not yet"}
Auto deploy: ${input.autoDeploy ? "enabled" : "disabled"}

Task:
- Read the linked issue, PR diff, labels, comments, and QA evidence with gh. Treat GitHub as the source of truth.
- Decide merge readiness without merging.

Hard rules:
- Do not add/remove GitHub labels or comments. Taskix server will apply labels/comments after your structured decision.
- If QA is required before merge, return decision "need_qa".
- If changes are required from developer, return decision "changes_requested" and include the required changes in comments.
- If QA is already passed or QA is not needed and the PR is acceptable, return decision "ready_to_merge".
- Never merge the PR and never return a merged state during review.
- If auto deploy is disabled, stop at taskix:ready-to-merge.
- If auto deploy is enabled and QA has passed, verify repository checks and branch state, then still stop at decision "ready_to_merge" without merging.

Return JSON with decision, summary, labelsApplied, comments. Set labelsApplied to an empty array.`;
    const result = await this.runJsonResult<ArchitectPrReviewResult>(prompt, schema);
    return result.value ? { ...result.value, executionLog: result.executionLog } : {
      decision: "blocked",
      summary: `Architect runner did not complete PR review for ${input.prUrl}.`,
      labelsApplied: [],
      comments: [],
      executionLog: result.executionLog
    };
  }

  async architectConfirmManualReady(input: {
    repo: string;
    issueNumber: number;
    prUrl: string;
  }): Promise<ArchitectPrReviewResult> {
    const workspaceDir = await this.prepareArchitectWorkspace(input.repo, `review-issue-${input.issueNumber}`);
    const schema = objectSchema({
      decision: { type: "string", enum: ["ready_to_merge", "changes_requested", "blocked"] },
      summary: { type: "string" },
      labelsApplied: { type: "array", items: { type: "string" } },
      comments: { type: "array", items: { type: "string" } }
    });
    const prompt = `${rolePrompts.reviewer}

GitHub repo: ${input.repo}
Issue: #${input.issueNumber}
PR: ${input.prUrl}
Workspace: ${workspaceDir}
Project deployment policy: manual deployment. This review stage must not merge, but an approved PR should proceed to the dedicated merge step.

Task:
- Read the issue, PR diff, labels, comments, and QA evidence with gh. Treat GitHub as the source of truth.
- Perform code review and merge-readiness review after QA has passed.

Hard rules:
- Do not merge the PR during this review stage.
- Manual deployment only restricts deployment after merge; it does not mean the PR should remain unmerged.
- If approved, state clearly that the PR is ready for the dedicated merge step.
- Do not generate deployment actions.
- Do not add or remove GitHub labels; Taskix will apply labels after your structured decision.
- Return "ready_to_merge" only when QA has passed and the PR satisfies the issue acceptance criteria.
- Return "changes_requested" if implementation changes are required.
- Return "blocked" if readiness cannot be determined from available GitHub state.
- Do not modify the current Taskix app checkout or its .git directory.
- The current working directory is the isolated architect clone: ${workspaceDir}.
- Run git and gh commands only in the current working directory unless explicitly inspecting GitHub metadata with gh.

Return JSON with decision, summary, labelsApplied, comments. Set labelsApplied to an empty array.`;
    const result = await this.runJsonResult<ArchitectPrReviewResult>(prompt, schema, { cwd: workspaceDir });
    return result.value ? { ...result.value, executionLog: result.executionLog } : {
      decision: "blocked",
      summary: `Architect runner did not complete manual ready review for ${input.prUrl}.`,
      labelsApplied: [],
      comments: [],
      executionLog: result.executionLog
    };
  }

  async qaReviewPr(input: {
    repo: string;
    issueNumber: number;
    prUrl: string;
    headSha?: string | null;
  }): Promise<QaPrReviewResult> {
    const schema = objectSchema({
      passed: { type: "boolean" },
      failureType: { type: "string", enum: ["none", "implementation", "spec", "environment", "stale"] },
      summary: { type: "string" },
      findings: { type: "array", items: { type: "string" } },
      labelsApplied: { type: "array", items: { type: "string" } },
      testsRun: { type: "array", items: { type: "string" } }
    });
    let workspaceDir: string;
    try {
      workspaceDir = await this.prepareQaWorkspace(input.repo, input.issueNumber, input.prUrl);
    } catch (error) {
      return {
        passed: false,
        failureType: "environment",
        summary: `QA workspace preparation failed for issue #${input.issueNumber}: ${error instanceof Error ? error.message : String(error)}`,
        findings: ["QA could not start because its isolated workspace could not be prepared."],
        labelsApplied: [],
        testsRun: []
      };
    }
    const prompt = `${rolePrompts.qa}

GitHub repo: ${input.repo}
Issue: #${input.issueNumber}
PR: ${input.prUrl}
Expected PR head SHA: ${input.headSha ?? "not captured"}
Workspace: ${workspaceDir}

Task:
- Read the issue, acceptance criteria, ownedPaths, PR diff, labels, and the full issue/PR comment timeline with gh. Treat GitHub as the source of truth.
- Do not rely only on the latest comment. Understand the whole issue history, including earlier QA failures, QA passes, architect blockers, developer retries, and whether the same requirement is cycling between incompatible fixes.
- Validate the captured PR version against the GitHub issue and comments.

Hard rules:
- If Expected PR head SHA is captured, verify the PR head still matches it before testing. If it changed, report blocked/stale QA instead of testing a moving target.
- Do not create/edit GitHub issues, PRs, labels, or comments. Taskix server will publish QA evidence and labels after you return JSON.
- Enforce ownedPaths, but allow minimal changes to automated test files that directly verify this issue's acceptance criteria, even when the architect omitted those test files from ownedPaths. Do not fail QA for that narrow test-scope exception; mention it in summary if relevant.
- When passing QA, include concise verification evidence in summary, including commands run and any observable state required by acceptance criteria.
- Before every failed result, explicitly re-evaluate whether the issue should return to developer or architect. If the current issue remains executable and the developer can fix it without changing the issue, use failureType "implementation". If the issue needs clarification or policy/architecture changes before a developer can know the correct fix, use failureType "spec".
- Classify the result with failureType:
  - "none" only when passed is true.
  - "implementation" when the issue requirements are clear and the PR implementation does not satisfy them. These go back to developer.
  - "spec" when acceptance criteria are missing, contradictory, mutually unsatisfiable, or not executable in this stack without an architect decision. These go back to architect, not developer.
  - "environment" when validation is blocked by local tooling/runtime constraints unrelated to the PR.
  - "stale" when the expected PR head SHA no longer matches.
- Use "spec" instead of "implementation" when a developer cannot choose the correct fix without changing the issue, security model, ownedPaths, dependency order, or acceptance criteria. In that case, labelsApplied must include "taskix:spec-blocked" and "taskix:blocked", and must not include "taskix:qa-failed".
- Use "environment" when local validation cannot proceed because of port binding, sandbox permissions, local tool failures, workspace preparation, or other runtime constraints unrelated to the PR. In that case, labelsApplied must include "taskix:env-blocked" and "taskix:blocked", and must not include "taskix:qa-failed".
- Use "spec" when the PR alternates between passing one requirement and failing another because the issue does not define the trusted signal, policy, dependency, interface, or ownership boundary needed to satisfy both. This is an architecture/specification problem even if a concrete probe can reproduce the current failure.
- Use "spec" when the issue has already cycled through multiple developer fixes and QA/architect findings show mutually incompatible expectations under the current issue text.
- Use "implementation" only when the existing issue is executable as written and the developer can fix the PR without architect clarification. In that case, labelsApplied should include "taskix:qa-failed".
- When failing QA, include actionable findings and reproduction notes. For spec failures, explain the architectural decision that is missing and do not prescribe code changes as if the developer can choose the policy alone.
- If a required baseline command fails for a repo-level reason that is clearly unrelated to the PR diff, report it as an environment or repository blocker in findings, but do not mark the PR implementation failed solely for that unrelated baseline failure when the acceptance criteria and PR-scoped automated tests pass.
- Do not modify the current Taskix app checkout or its .git directory.
- The current working directory is the isolated QA clone for this PR: ${workspaceDir}.
- Run git, npm, and browser validation commands only in the current working directory unless explicitly inspecting GitHub with gh.

Return JSON with passed, failureType, summary, findings, labelsApplied, testsRun.`;
    const result = await this.runJsonResult<QaPrReviewResult>(prompt, schema, { cwd: workspaceDir });
    return result.value ? { ...result.value, executionLog: result.executionLog } : {
      passed: false,
      failureType: "environment",
      summary: `QA runner did not complete PR review for ${input.prUrl}.`,
      findings: ["QA runner did not return a result."],
      labelsApplied: [],
      testsRun: [],
      executionLog: result.executionLog
    };
  }

  async qaReview(issue: IssueSpec, developerResult: DeveloperResult): Promise<QaResult> {
    const ownedPaths = issue.ownedPaths ?? [];
    const schema = objectSchema({
      passed: { type: "boolean" },
      summary: { type: "string" },
      findings: { type: "array", items: { type: "string" } },
      followUpIssue: {
        anyOf: [
          { type: "null" },
          objectSchema({
            title: { type: "string" },
            description: { type: "string" },
            assigneeRole: {
              type: "string",
              enum: ["developer", "qa", "architect", "product_manager"]
            },
            developerRole: { type: "string", enum: developerRoleIds },
            ownedPaths: { type: "array", items: { type: "string" } },
            acceptanceCriteria: { type: "array", items: { type: "string" } }
          })
        ]
      }
    });
    const prompt = `${rolePrompts.qa}

Issue: ${issue.title}
Developer role: ${issue.developerRole ?? "developer"}
Owned paths:
${ownedPaths.map((item) => `- ${item}`).join("\n")}

Acceptance criteria:
${issue.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}

Developer summary:
${developerResult.summary}

Validate the proposed PR as QA. Check both acceptance criteria and whether the developer respected ownedPaths. If defects are found, create a follow-up implementation issue with clear developerRole and ownedPaths.

If you create a follow-up issue, developerRole must be one of:
${developerRoleIds.map((role) => `- ${role}`).join("\n")}
Do not invent new developerRole ids.`;
    return (await this.runJson<QaResult>(prompt, schema)) ?? { passed: true, summary: `QA validated ${issue.title}`, findings: [] };
  }

  async architectReviewDelivery(issue: IssueSpec, developerResult: DeveloperResult, qaResult: QaResult): Promise<ArchitectReviewResult> {
    const ownedPaths = issue.ownedPaths ?? [];
    const schema = objectSchema({
      approved: { type: "boolean" },
      summary: { type: "string" },
      mergePlan: { type: "string" },
      deploymentPlan: { type: "string" },
      risks: { type: "array", items: { type: "string" } }
    });
    const prompt = `${rolePrompts.architect}

Issue: ${issue.title}
Developer role: ${issue.developerRole ?? "developer"}
Owned paths:
${ownedPaths.map((item) => `- ${item}`).join("\n")}

Acceptance criteria:
${issue.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}

Developer summary:
${developerResult.summary}

QA result:
${JSON.stringify(qaResult, null, 2)}

Review code and PR readiness as the architect. Decide whether it is ready to merge after QA, verify directory ownership boundaries were respected, then describe merge and deployment plans.`;
    return (
      (await this.runJson<ArchitectReviewResult>(prompt, schema)) ?? {
        approved: qaResult.passed,
        summary: qaResult.passed ? `Architect approved ${issue.title} after QA` : `Architect blocked ${issue.title} due to QA findings`,
        mergePlan: qaResult.passed ? "Merge after final branch checks pass." : "Do not merge until follow-up fixes pass QA.",
        deploymentPlan: qaResult.passed ? "Deploy with the next release batch." : "Deployment blocked.",
        risks: qaResult.findings
      }
    );
  }

  async architectReleaseSummary(requirement: string, results: unknown[], autoDeploy: boolean): Promise<string> {
    return (
      await this.runText(`${rolePrompts.architect}

Requirement:
${requirement}

Project deployment policy:
${autoDeploy ? "Automatic deployment is enabled after QA passes and architect approval." : "Automatic deployment is disabled. Stop after merge readiness and wait for manual deployment approval."}

Results:
${JSON.stringify(results, null, 2)}

Summarize code review outcome, merge readiness, and deployment status according to the deployment policy.`)
    )?.text ?? (autoDeploy ? "Reviewer completed. All approved issues are ready for merge and automatic deployment in mock mode." : "Reviewer completed. All approved issues are merge-ready; automatic deployment is disabled.");
  }

  private async runJson<T>(prompt: string, schema: object): Promise<T | null> {
    return (await this.runJsonResult<T>(prompt, schema)).value;
  }

  private async runJsonResult<T>(prompt: string, schema: object, options: RunJsonOptions = {}): Promise<{ value: T | null; error: string | null; executionLog: string }> {
    const tmp = await this.tmpDir();
    const schemaPath = path.join(tmp, "schema.json");
    const outputPath = path.join(tmp, "output.json");
    await writeFile(schemaPath, JSON.stringify(schema), "utf8");
    const result = await this.runCodex([
      "--skip-git-repo-check",
      "--sandbox",
      this.settings.codexSandbox,
      ...approvalArgs(this.settings.codexApprovalPolicy),
      "--model",
      this.settings.codexModel,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      prompt
    ], { cwd: options.cwd });
    const executionLog = formatCodexExecutionLog(result.stdout, result.stderr);
    if (!result.ok) return { value: null, error: result.stderr.trim() || "Codex exited with a non-zero status.", executionLog };
    try {
      return { value: JSON.parse(await readFile(outputPath, "utf8")) as T, error: null, executionLog };
    } catch {
      return { value: null, error: "Codex completed but did not produce valid JSON output.", executionLog };
    }
  }

  private async runText(prompt: string, sessionId?: string | null, options: RunTextOptions = {}): Promise<CodexTextResult | null> {
    const tmp = await this.tmpDir();
    const outputPath = path.join(tmp, "output.txt");
    const args = sessionId ? ["resume", "--skip-git-repo-check", "--model", this.settings.codexModel, "-o", outputPath, sessionId, prompt] : ["--skip-git-repo-check", "--sandbox", this.settings.codexSandbox, ...approvalArgs(this.settings.codexApprovalPolicy), "--model", this.settings.codexModel, "-o", outputPath, prompt];
    const result = await this.runCodex(args, { cwd: options.cwd });
    if (!result.ok) return null;
    try {
      return { text: (await readFile(outputPath, "utf8")).trim(), sessionId: extractSessionId(result.stderr) ?? sessionId, executionLog: formatCodexExecutionLog(result.stdout, result.stderr) };
    } catch {
      return null;
    }
  }

  private async runCodex(args: string[], options: RunCodexOptions = {}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const codexHome = this.settings.codexHome;
    await mkdir(codexHome, { recursive: true });
    return new Promise((resolve) => {
      const child = spawn(this.settings.codexBin, ["exec", ...args], {
        cwd: options.cwd ?? rootDir,
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const activeJobId = getActiveJobId();
      if (activeJobId) void touchJobRuntime(activeJobId, { pid: child.pid ?? null });
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        resolve({ ok: false, stdout, stderr: `${stderr}\nCodex timed out after ${Math.round(codexTimeoutMs / 1000)} seconds.` });
      }, codexTimeoutMs);
      child.stdout.on("data", (chunk) => {
        const text = normalizeRuntimeOutput(chunk);
        stdout += text;
        if (activeJobId) void touchJobRuntime(activeJobId, { output: true, outputChunk: text });
      });
      child.stderr.on("data", (chunk) => {
        const text = normalizeRuntimeOutput(chunk);
        stderr += text;
        if (activeJobId) void touchJobRuntime(activeJobId, { output: true, outputChunk: text });
      });
      child.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, stdout, stderr });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: code === 0, stdout, stderr });
      });
    });
  }

  private async tmpDir(): Promise<string> {
    return mkdir(await os.tmpdir(), { recursive: true }).then(() => path.join(os.tmpdir(), `taskix-${Date.now()}-${Math.random().toString(16).slice(2)}`)).then(async (dir) => {
      await mkdir(dir, { recursive: true });
      return dir;
    });
  }

  private async prepareDeveloperWorkspace(repo: string, workflowId: string, issueNumber: number): Promise<string> {
    const workspaceRoot = path.join(dataDir, "taskix-workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const baseDir = path.join(workspaceRoot, sanitizePathSegment(`${workflowId}-issue-${issueNumber}`));
    const workspaceDir = await chooseWorkspaceDir(baseDir);

    if (!existsSync(path.join(workspaceDir, ".git"))) {
      await mkdir(path.dirname(workspaceDir), { recursive: true });
      await execFileAsync("gh", ["repo", "clone", repo, workspaceDir]);
      return workspaceDir;
    }

    try {
      await execFileAsync("git", ["-C", workspaceDir, "fetch", "origin", "--prune"]);
    } catch {
      // A stale clone is still a safer execution directory than the app checkout.
    }
    return workspaceDir;
  }

  private async collectDeveloperWorktreeFacts(input: {
    repo: string;
    workspaceDir: string;
    baseBranch: string;
    expectedBranch: string;
    activeBranch: string | null;
    activePrUrl: string | null;
  }): Promise<DeveloperWorktreeFacts> {
    const fetchSummary = await gitFact(input.workspaceDir, ["fetch", "origin", "--prune"]);
    const prNumber = input.activePrUrl ? extractPullRequestNumber(input.activePrUrl) : null;
    const activePr = prNumber ? await ghJsonFact<{ headRefName?: string; headRefOid?: string; baseRefName?: string }>(input.workspaceDir, [
      "pr",
      "view",
      String(prNumber),
      "--repo",
      input.repo,
      "--json",
      "headRefName,headRefOid,baseRefName"
    ]) : null;
    const activePrBranch = activePr?.headRefName ?? input.activeBranch ?? null;
    const activePrHead = activePr?.headRefOid ?? null;
    const activePrBase = activePr?.baseRefName ?? input.baseBranch;
    const currentBranch = oneLine(await gitFact(input.workspaceDir, ["branch", "--show-current"]));
    const currentHead = oneLine(await gitFact(input.workspaceDir, ["rev-parse", "HEAD"]));
    const baseHead = oneLine(await gitFact(input.workspaceDir, ["rev-parse", `origin/${input.baseBranch}`]));
    const statusShort = await gitFact(input.workspaceDir, ["status", "--short", "--branch"]);
    const diffNameStatus = await gitFact(input.workspaceDir, ["diff", "--name-status"]);
    const diffAgainstActiveBranch = activePrBranch
      ? await gitFact(input.workspaceDir, ["diff", "--name-status", `origin/${activePrBranch}`])
      : "";
    return {
      expectedBranch: input.expectedBranch,
      activePrBranch,
      activePrHead,
      activePrBase,
      currentBranch,
      currentHead,
      baseBranch: input.baseBranch,
      baseHead,
      statusShort,
      diffNameStatus,
      diffAgainstActiveBranch,
      fetchSummary
    };
  }

  private async prepareQaWorkspace(repo: string, issueNumber: number, prUrl: string): Promise<string> {
    const workspaceRoot = path.join(dataDir, "taskix-workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const baseDir = path.join(workspaceRoot, sanitizePathSegment(`qa-issue-${issueNumber}`));
    const workspaceDir = await chooseWorkspaceDir(baseDir);

    if (!existsSync(path.join(workspaceDir, ".git"))) {
      await mkdir(path.dirname(workspaceDir), { recursive: true });
      await execFileAsync("gh", ["repo", "clone", repo, workspaceDir]);
    }

    try {
      await execFileAsync("git", ["-C", workspaceDir, "fetch", "origin", "--prune"]);
    } catch {
      // QA can still inspect the PR through gh even when fetch fails.
    }

    const prNumber = extractPullRequestNumber(prUrl);
    if (prNumber) {
      try {
        await execFileAsync("gh", ["pr", "checkout", String(prNumber), "--repo", repo], { cwd: workspaceDir });
        return workspaceDir;
      } catch {
        // Fall back to the repository base branch; the QA prompt still requires gh PR inspection.
      }
    }

    await checkoutWorkspaceBase(workspaceDir);
    return workspaceDir;
  }

  private async prepareArchitectWorkspace(repo: string, context: string): Promise<string> {
    const workspaceRoot = path.join(dataDir, "taskix-workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const baseDir = path.join(workspaceRoot, sanitizePathSegment(`architect-${context}`));
    const workspaceDir = await chooseWorkspaceDir(baseDir);

    if (!existsSync(path.join(workspaceDir, ".git"))) {
      await mkdir(path.dirname(workspaceDir), { recursive: true });
      await execFileAsync("gh", ["repo", "clone", repo, workspaceDir]);
      await checkoutWorkspaceBase(workspaceDir);
      return workspaceDir;
    }

    try {
      await execFileAsync("git", ["-C", workspaceDir, "fetch", "origin", "--prune"]);
    } catch {
      // A stale architect clone is still safer than running inside the app checkout.
    }
    await checkoutWorkspaceBase(workspaceDir);
    return workspaceDir;
  }
}

function objectSchema(properties: Record<string, unknown>): object {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function extractSessionId(stderr: string): string | null {
  const line = stderr.split("\n").find((item) => item.toLowerCase().includes("session id:"));
  return line?.split(":").slice(1).join(":").trim() || null;
}

function formatCodexExecutionLog(stdout: string, stderr: string): string {
  const sections = [
    stdout.trim() ? `stdout\n${stdout.trim()}` : "",
    stderr.trim() ? `stderr\n${stderr.trim()}` : ""
  ].filter(Boolean);
  return sections.join("\n\n");
}

function approvalArgs(policy: string): string[] {
  return policy === "never" ? ["--full-auto"] : [];
}

async function chooseWorkspaceDir(baseDir: string): Promise<string> {
  if (!existsSync(baseDir) || existsSync(path.join(baseDir, ".git"))) return baseDir;
  const fallback = `${baseDir}-${Date.now().toString(36)}`;
  await mkdir(path.dirname(fallback), { recursive: true });
  return fallback;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function extractPullRequestNumber(prUrl: string): number | null {
  const match = prUrl.match(/\/pull\/(\d+)(?:\D|$)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

async function checkoutWorkspaceBase(workspaceDir: string): Promise<void> {
  const branch = expectedDeveloperBaseBranch();
  try {
    await execFileAsync("git", ["-C", workspaceDir, "fetch", "origin", branch]);
    await execFileAsync("git", ["-C", workspaceDir, "checkout", "-B", branch, `origin/${branch}`]);
  } catch {
    // If the target branch is not available remotely, keep the clone's default branch.
  }
}

function mockIssues(): IssueSpec[] {
  return [
    {
      title: "Implement project workflow intake",
      description: "Accept confirmed requirements and create a project-scoped workflow.",
      assigneeRole: "developer",
      developerRole: "backend_developer",
      ownedPaths: ["src/app/api", "src/lib"],
      acceptanceCriteria: ["Workflow is linked to the active project", "Issue creation uses project GitHub credentials"]
    },
    {
      title: "Add role orchestration for confirmed requirements",
      description: "Run planner issue breakdown, developer implementation, QA, review, and merge after PM confirms scope.",
      assigneeRole: "developer",
      developerRole: "backend_developer",
      ownedPaths: ["src/lib"],
      acceptanceCriteria: ["Developer roles run concurrently", "Architect findings can create follow-up issues"]
    }
  ];
}
