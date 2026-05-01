import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { developerRoleIds, developerRoleProfile, formatDeveloperRoleCatalog } from "@/lib/developer-roles";
import type { ArchitectPrReviewResult, ArchitectReviewResult, DeveloperIssueResult, DeveloperResult, IssueSpec, QaPrReviewResult, QaResult } from "@/lib/types";
import { rootDir } from "@/lib/paths";
import type { Settings } from "@/lib/types";

type CodexTextResult = { text: string; sessionId?: string | null };
const codexTimeoutMs = 10 * 60 * 1000;
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
              acceptanceCriteria: { type: "array", items: { type: "string" } }
            },
            required: ["title", "description", "assigneeRole", "developerRole", "ownedPaths", "acceptanceCriteria"],
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
- Keep ownedPaths as non-overlapping as possible across issues to reduce code conflicts.
- Each issue should have clear directory ownership and should not require edits outside ownedPaths unless explicitly stated in acceptance criteria.`;
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
  }): Promise<DeveloperIssueResult> {
    const ownedPaths = input.issue.ownedPaths ?? [];
    const schema = objectSchema({
      summary: { type: "string" },
      branch: { type: "string" },
      prUrl: { type: "string" },
      changedFiles: { type: "array", items: { type: "string" } },
      testsRun: { type: "array", items: { type: "string" } }
    });
    const prompt = `${rolePrompts.developer}

GitHub repo: ${input.repo}
GitHub issue: #${input.issueNumber}
Workflow: ${input.workflowId}

Developer role: ${input.issue.developerRole ?? "general_developer"}
Role profile:
${developerRoleProfile(input.issue.developerRole)}

Owned paths:
${ownedPaths.map((item) => `- ${item}`).join("\n")}

Required GitHub label behavior:
- Add taskix:dev-running to issue #${input.issueNumber} when you start.
- Create a pull request linked to issue #${input.issueNumber}.
- Add taskix:pr-opened and taskix:architect-review to the PR.
- Keep the role label role:${input.issue.developerRole ?? "general_developer"} on the issue/PR.

Execution rules:
- Use gh to read issue #${input.issueNumber}; treat GitHub as the source of truth.
- Do not modify the current Taskix app checkout or its .git directory.
- Create or reuse an isolated working clone under data/taskix-workspaces/${input.workflowId}-issue-${input.issueNumber}.
- Run git fetch, checkout, commit, push, and gh pr create only inside that isolated clone.
- Work only inside ownedPaths unless the issue explicitly requires an integration point.
- Create a branch named taskix/${input.workflowId}-issue-${input.issueNumber} or a similarly unique branch.
- Implement the issue, run relevant tests, commit, push, and open a PR.
- If implementation is blocked, comment on the issue, add taskix:blocked, and still return JSON with prUrl as an empty string.

Return JSON with summary, branch, prUrl, changedFiles, testsRun.`;
    const result = await this.runJsonResult<DeveloperIssueResult>(prompt, schema);
    return result.value ?? {
      summary: `Developer runner did not complete issue #${input.issueNumber}.${result.error ? `\n\nCodex error:\n${result.error}` : ""}`,
      branch: "",
      prUrl: "",
      changedFiles: [],
      testsRun: []
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
      decision: { type: "string", enum: ["need_qa", "ready_to_merge", "changes_requested", "merged", "blocked"] },
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

Required GitHub label behavior:
- Read the linked issue and PR with gh.
- If QA is required before merge, add taskix:need-qa to the PR and issue, then return decision "need_qa".
- If changes are required from developer, comment on the PR, add taskix:blocked, and return decision "changes_requested".
- If QA is already passed or QA is not needed and the PR is acceptable, add taskix:ready-to-merge and return decision "ready_to_merge".
- If auto deploy is disabled, do not merge the PR; stop at taskix:ready-to-merge.
- If auto deploy is enabled and QA has passed, you may merge only when repository checks and branch state are safe.

Return JSON with decision, summary, labelsApplied, comments.`;
    return (await this.runJson<ArchitectPrReviewResult>(prompt, schema)) ?? {
      decision: "blocked",
      summary: `Architect runner did not complete PR review for ${input.prUrl}.`,
      labelsApplied: [],
      comments: []
    };
  }

  async qaReviewPr(input: {
    repo: string;
    issueNumber: number;
    prUrl: string;
  }): Promise<QaPrReviewResult> {
    const schema = objectSchema({
      passed: { type: "boolean" },
      summary: { type: "string" },
      findings: { type: "array", items: { type: "string" } },
      labelsApplied: { type: "array", items: { type: "string" } },
      testsRun: { type: "array", items: { type: "string" } }
    });
    const prompt = `${rolePrompts.qa}

GitHub repo: ${input.repo}
Issue: #${input.issueNumber}
PR: ${input.prUrl}

Required GitHub label behavior:
- Add taskix:qa-running to the issue and PR when you start.
- Read the issue acceptance criteria and PR diff using gh.
- Validate implementation, ownedPaths, and relevant tests.
- If passed, add taskix:qa-passed and remove taskix:qa-running.
- If failed, comment findings on the PR, add taskix:qa-failed, and remove taskix:qa-running.

Return JSON with passed, summary, findings, labelsApplied, testsRun.`;
    return (await this.runJson<QaPrReviewResult>(prompt, schema)) ?? {
      passed: false,
      summary: `QA runner did not complete PR review for ${input.prUrl}.`,
      findings: ["QA runner did not return a result."],
      labelsApplied: [],
      testsRun: []
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

  private async runJsonResult<T>(prompt: string, schema: object): Promise<{ value: T | null; error: string | null }> {
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
    ]);
    if (!result.ok) return { value: null, error: result.stderr.trim() || "Codex exited with a non-zero status." };
    try {
      return { value: JSON.parse(await readFile(outputPath, "utf8")) as T, error: null };
    } catch {
      return { value: null, error: "Codex completed but did not produce valid JSON output." };
    }
  }

  private async runText(prompt: string, sessionId?: string | null): Promise<CodexTextResult | null> {
    const tmp = await this.tmpDir();
    const outputPath = path.join(tmp, "output.txt");
    const args = sessionId ? ["resume", "--skip-git-repo-check", "--model", this.settings.codexModel, "-o", outputPath, sessionId, prompt] : ["--skip-git-repo-check", "--sandbox", this.settings.codexSandbox, ...approvalArgs(this.settings.codexApprovalPolicy), "--model", this.settings.codexModel, "-o", outputPath, prompt];
    const result = await this.runCodex(args);
    if (!result.ok) return null;
    try {
      return { text: (await readFile(outputPath, "utf8")).trim(), sessionId: extractSessionId(result.stderr) ?? sessionId };
    } catch {
      return null;
    }
  }

  private async runCodex(args: string[]): Promise<{ ok: boolean; stderr: string }> {
    const codexHome = this.settings.codexHome;
    await mkdir(codexHome, { recursive: true });
    return new Promise((resolve) => {
      const child = spawn(this.settings.codexBin, ["exec", ...args], {
        cwd: rootDir,
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        resolve({ ok: false, stderr: `${stderr}\nCodex timed out after ${Math.round(codexTimeoutMs / 1000)} seconds.` });
      }, codexTimeoutMs);
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, stderr });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok: code === 0, stderr });
      });
    });
  }

  private async tmpDir(): Promise<string> {
    return mkdir(await os.tmpdir(), { recursive: true }).then(() => path.join(os.tmpdir(), `taskix-${Date.now()}-${Math.random().toString(16).slice(2)}`)).then(async (dir) => {
      await mkdir(dir, { recursive: true });
      return dir;
    });
  }
}

function objectSchema(properties: Record<string, unknown>): object {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function extractSessionId(stderr: string): string | null {
  const line = stderr.split("\n").find((item) => item.toLowerCase().includes("session id:"));
  return line?.split(":").slice(1).join(":").trim() || null;
}

function approvalArgs(policy: string): string[] {
  return policy === "never" ? ["--full-auto"] : [];
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
