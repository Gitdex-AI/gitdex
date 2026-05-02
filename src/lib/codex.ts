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
type RunCodexOptions = { cwd?: string };
const execFileAsync = promisify(execFile);
const codexTimeoutMs = 10 * 60 * 1000;
const ansiPattern = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function normalizeRuntimeOutput(chunk: Buffer | string): string {
  return String(chunk).replace(ansiPattern, "");
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
};

const rolePrompts = {
  product_manager:
    "You are a Codex product manager. Stay available for user conversation, clarify requirements, and only hand confirmed requirements to the architect. Do not perform long-running implementation work.",
  developer:
    "You are a Codex developer. Work only within the directories assigned by the architect, keep ownership boundaries clear, and avoid touching files owned by other parallel developers.",
  qa:
    "You are a Codex QA engineer. Validate implementation against acceptance criteria, identify defects and regressions, and create follow-up issues for fixes. Do not decide merge or deployment.",
  architect:
    "You are a Codex architect. Turn confirmed requirements into implementation issues, coordinate developer roles, review code/PRs after QA, and decide merge readiness. Do not own deployment setup.",
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
        text: "PM mock response: I captured the requirement. Use /confirm <requirement> when the scope is ready for architect planning.",
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
    const prompt = `${rolePrompts.architect}

Project: ${input.projectName}
GitHub repo: ${input.githubRepo}

User message:
${input.message}`;
    const result = await this.runText(prompt, input.sessionId);
    return (
      result ?? {
        text: "Architect mock response: I captured this project context and can review architecture, issue ownership, merge readiness, and deployment strategy.",
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

You are resolving a blocked Taskix workflow, not just giving advice.

Resolution rules:
- If the blocker can be fixed by narrowing scope, correcting ownedPaths, or making acceptance criteria executable, return action "retry_developer".
- For retry_developer, return a complete revised issue title, description, ownedPaths, developerRole, and acceptanceCriteria that a developer can execute immediately.
- If the blocker needs a user decision that cannot be inferred, return action "request_user_input" and put the exact question in comment.
- Only return action "mark_blocked" if the issue cannot proceed safely.
- Do not return general advice. Return a concrete executable resolution.

Blocked context:
${input.blockedContext}`;

    const resolution = await this.runJson<ArchitectBlockerResolution>(prompt, schema);
    return {
      resolution: resolution ?? {
        action: "request_user_input",
        summary: "Architect could not produce a structured blocker resolution.",
        issueTitle: "",
        issueDescription: "",
        developerRole: "general_developer",
        ownedPaths: [],
        acceptanceCriteria: [],
        comment: "Please clarify the implementation scope and valid owned paths before retrying the developer."
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
    const prompt = `${rolePrompts.architect}

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
- Set dependsOn to the titles of issues that must complete first. Use [] for issues that can start immediately.
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
        branch: "",
        prUrl: "",
        changedFiles: [],
        testsRun: []
      };
    }
    const baseBranch = expectedDeveloperBaseBranch();
    const prompt = `${rolePrompts.developer}

GitHub repo: ${input.repo}
GitHub issue: #${input.issueNumber}
Workspace: ${workspaceDir}
Base branch: ${baseBranch ?? "repository default branch"}
Current active PR: ${input.activePrUrl ?? "none"}
Current active branch: ${input.activeBranch ?? "none"}
Returned from QA: ${input.returnedFromQa ? "yes" : "no"}

Task:
- Read issue #${input.issueNumber}, labels, linked PRs, and latest comments with gh. Treat GitHub as the source of truth for requirements, ownedPaths, acceptance criteria, dependencies, and prior QA/architect feedback.
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
- If there is no active PR, create a branch named taskix/${input.workflowId}-issue-${input.issueNumber} or a similarly unique branch.
- Implement the issue, run relevant tests, commit, and push the branch. Do not run gh pr create.
- Do not add/remove GitHub labels or comments. Taskix server will create/update the PR and labels after you return JSON.
- If implementation is blocked, return JSON with prUrl as an empty string and explain the blocker in summary.

Return JSON with summary, branch, prUrl, changedFiles, testsRun.`;
    const result = await this.runJsonResult<DeveloperIssueResult>(prompt, schema, { cwd: workspaceDir });
    return result.value ? { ...result.value, executionLog: result.executionLog } : {
      summary: `Developer runner did not complete issue #${input.issueNumber}.${result.error ? `\n\nCodex error:\n${result.error}` : ""}`,
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
    const prompt = `${rolePrompts.architect}

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
    const schema = objectSchema({
      decision: { type: "string", enum: ["ready_to_merge", "changes_requested", "blocked"] },
      summary: { type: "string" },
      labelsApplied: { type: "array", items: { type: "string" } },
      comments: { type: "array", items: { type: "string" } }
    });
    const prompt = `${rolePrompts.architect}

GitHub repo: ${input.repo}
Issue: #${input.issueNumber}
PR: ${input.prUrl}
Project deployment policy: manual deploy; do not merge.

Task:
- Read the issue, PR diff, labels, comments, and QA evidence with gh. Treat GitHub as the source of truth.
- Perform architect code review and merge-readiness review after QA has passed.

Hard rules:
- Do not merge the PR.
- Preserve manual-deploy handling by stopping at merge readiness only; do not generate merge, deploy, or PR-closing actions.
- Do not add or remove GitHub labels; Taskix will apply labels after your structured decision.
- Return "ready_to_merge" only when QA has passed and the PR satisfies the issue acceptance criteria.
- Return "changes_requested" if implementation changes are required.
- Return "blocked" if readiness cannot be determined from available GitHub state.

Return JSON with decision, summary, labelsApplied, comments. Set labelsApplied to an empty array.`;
    const result = await this.runJsonResult<ArchitectPrReviewResult>(prompt, schema);
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
- Read the issue, acceptance criteria, ownedPaths, PR diff, labels, and comments with gh. Treat GitHub as the source of truth.
- Validate the captured PR version against the GitHub issue and comments.

Hard rules:
- If Expected PR head SHA is captured, verify the PR head still matches it before testing. If it changed, report blocked/stale QA instead of testing a moving target.
- Do not create/edit GitHub issues, PRs, labels, or comments. Taskix server will publish QA evidence and labels after you return JSON.
- Enforce ownedPaths, but allow minimal changes to automated test files that directly verify this issue's acceptance criteria, even when the architect omitted those test files from ownedPaths. Do not fail QA for that narrow test-scope exception; mention it in summary if relevant.
- When passing QA, include concise verification evidence in summary, including commands run and any observable state required by acceptance criteria.
- When failing QA, include actionable findings and reproduction notes.
- If a required baseline command fails for a repo-level reason that is clearly unrelated to the PR diff, report it as an environment or repository blocker in findings, but do not mark the PR implementation failed solely for that unrelated baseline failure when the acceptance criteria and PR-scoped automated tests pass.
- Do not modify the current Taskix app checkout or its .git directory.
- The current working directory is the isolated QA clone for this PR: ${workspaceDir}.
- Run git, npm, and browser validation commands only in the current working directory unless explicitly inspecting GitHub with gh.

Return JSON with passed, summary, findings, labelsApplied, testsRun.`;
    const result = await this.runJsonResult<QaPrReviewResult>(prompt, schema, { cwd: workspaceDir });
    return result.value ? { ...result.value, executionLog: result.executionLog } : {
      passed: false,
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
    )?.text ?? (autoDeploy ? "Architect review complete. All approved issues are ready for merge and automatic deployment in mock mode." : "Architect review complete. All approved issues are merge-ready; automatic deployment is disabled.");
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

  private async runText(prompt: string, sessionId?: string | null): Promise<CodexTextResult | null> {
    const tmp = await this.tmpDir();
    const outputPath = path.join(tmp, "output.txt");
    const args = sessionId ? ["resume", "--skip-git-repo-check", "--model", this.settings.codexModel, "-o", outputPath, sessionId, prompt] : ["--skip-git-repo-check", "--sandbox", this.settings.codexSandbox, ...approvalArgs(this.settings.codexApprovalPolicy), "--model", this.settings.codexModel, "-o", outputPath, prompt];
    const result = await this.runCodex(args);
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
      await checkoutWorkspaceBase(workspaceDir);
      return workspaceDir;
    }

    try {
      await execFileAsync("git", ["-C", workspaceDir, "fetch", "origin", "--prune"]);
    } catch {
      // A stale clone is still a safer execution directory than the app checkout.
    }
    await checkoutWorkspaceBase(workspaceDir);
    return workspaceDir;
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
      description: "Run architect planning, developer implementation, and architect review after PM confirms scope.",
      assigneeRole: "developer",
      developerRole: "backend_developer",
      ownedPaths: ["src/lib"],
      acceptanceCriteria: ["Developer roles run concurrently", "Architect findings can create follow-up issues"]
    }
  ];
}
