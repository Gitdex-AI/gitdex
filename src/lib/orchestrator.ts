import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CodexClient } from "@/lib/codex";
import { GitHubClient } from "@/lib/github";
import { addLabelsWithGh, commentIssueWithGh, commentPullRequestWithGh, createIssueWithGh, createPullRequestWithGh, findPullRequestByHeadWithGh, getIssueSnapshotWithGh, removeLabelsWithGh } from "@/lib/github-local";
import { expectedDeveloperBaseBranch, expectedDeveloperBranch, isRecoverablePrBase, prRecoveryBranches } from "@/lib/issue-run-policy";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, cancelPendingJobs, createJob, listJobs, listWorkflows, saveProject, saveWorkflow, getWorkflow } from "@/lib/store";
import type { DeveloperIssueResult, IssueRecord, IssueSpec, ProjectRecord, QaPrReviewResult, WorkflowRecord } from "@/lib/types";

const execFileAsync = promisify(execFile);

export async function createWorkflow(requirement: string, chatId: number, project?: ProjectRecord | null): Promise<WorkflowRecord> {
  const createdAt = new Date().toISOString();
  const trackingCode = await nextWorkflowTrackingCode(createdAt);
  const workflow: WorkflowRecord = {
    workflowId: randomUUID().slice(0, 8),
    trackingCode,
    userRequirement: requirement,
    status: "created",
    chatId,
    createdAt,
    paused: false,
    pausedAt: null,
    projectId: project?.projectId ?? null,
    projectName: project?.name ?? null,
    issues: [],
    timeline: [project ? `Workflow ${trackingCode} created for project ${project.name}.` : `Workflow ${trackingCode} created.`]
  };
  await saveWorkflow(workflow);
  return workflow;
}

async function nextWorkflowTrackingCode(createdAt: string): Promise<string> {
  const day = createdAt.slice(0, 10).replace(/-/g, "");
  const prefix = `WF-${day}-`;
  const existing = await listWorkflows();
  const next = existing
    .map((workflow) => workflow.trackingCode ?? "")
    .filter((code) => code.startsWith(prefix))
    .map((code) => Number(code.slice(prefix.length)))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export async function runWorkflow(workflowId: string, project?: ProjectRecord | null): Promise<WorkflowRecord> {
  const settings = await getSettings();
  const codex = new CodexClient(settings);
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  const issueCreator = createIssueCreator(project, settings);

  const issues = await codex.architectPlanIssues(workflow.userRequirement);
  workflow.issues = [];
  workflow.status = "transferred_to_github";
  workflow.timeline.push("PM confirmed scope and handed requirement to architect.");
  workflow.timeline.push("Architect generated implementation issue breakdown.");
  if (project?.projectId) {
    await appendAgentMessages({
      sessionKey: `${project.projectId}:architect`,
      projectId: project.projectId,
      role: "architect",
      title: "Architect",
      workflowId: workflow.workflowId,
      messages: [
        {
          role: "user",
          content: `PM handed off workflow ${displayWorkflowCode(workflow)}:\n\n${workflow.userRequirement}`,
          createdAt: new Date().toISOString()
        },
        {
          role: "assistant",
          content: `Architect planned ${issues.length} implementation issue(s):\n\n${issues.map((issue, index) => {
            const ownedPaths = issue.ownedPaths.length ? issue.ownedPaths.join(", ") : "unspecified";
            return `${index + 1}. ${issue.title}\nDeveloper role: ${issue.developerRole ?? issue.assigneeRole}\nOwned paths: ${ownedPaths}\nAcceptance criteria:\n${issue.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`;
          }).join("\n\n")}`,
          createdAt: new Date().toISOString()
        }
      ]
    });
  }

  for (const [index, issue] of issues.entries()) {
    const created = await issueCreator(issue);
    workflow.issues.push({
      ...issue,
      issueId: `${displayWorkflowCode(workflow)}-${index + 1}`,
      githubIssueNumber: created.number,
      githubIssueUrl: created.htmlUrl,
      developerSessionId: `${workflow.workflowId}-${index + 1}:developer`,
      qaSessionId: `${workflow.workflowId}-${index + 1}:qa`,
      dependsOn: issue.dependsOn ?? [],
      parallelGroup: issue.parallelGroup ?? null,
      executionOrder: issue.executionOrder ?? index + 1
    });
  }

  workflow.status = "transferred_to_github";
  workflow.timeline.push(`Created ${workflow.issues.length} GitHub issue(s) with Taskix labels.`);
  if (project?.projectId) {
    const queued = await queueReadyDeveloperJobs(project.projectId, workflow);
    workflow.timeline.push(`Queued ${queued} ready developer issue job(s). Issues with dependencies wait for their prerequisites.`);
  } else {
    workflow.timeline.push("Developer issue jobs were not queued because this workflow is not bound to a project.");
  }

  await saveWorkflow(workflow);
  if (project) await saveProject(project);
  return workflow;
}

export async function runWorkflowIssue(workflowId: string, issueId: string, project?: ProjectRecord | null): Promise<WorkflowRecord> {
  const settings = await getSettings();
  const codex = new CodexClient(settings);
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
  const issue = workflow.issues.find((item) => item.issueId === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found in workflow ${displayWorkflowCode(workflow)}`);

  workflow.status = "in_progress";
  workflow.timeline.push(`Retrying developer for issue ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const result = await runIssue(issue, workflow, codex, createIssueCreator(project, settings), project);
  workflow.timeline.push(...result.timeline);
  if (project?.projectId) {
    const queued = await queueReadyDeveloperJobs(project.projectId, workflow);
    if (queued) workflow.timeline.push(`Queued ${queued} dependent developer issue job(s) now that prerequisites are satisfied.`);
  }
  workflow.status = deriveWorkflowStatus(workflow);
  if (result.blocked) workflow.status = "blocked";
  await saveWorkflow(workflow);
  if (project) await saveProject(project);
  return workflow;
}

export async function runWorkflowQa(workflowId: string, issueId: string, project?: ProjectRecord | null, qaContext: { prUrl?: string | null; headSha?: string | null; qaAttempt?: number | null } = {}): Promise<WorkflowRecord> {
  const settings = await getSettings();
  const codex = new CodexClient(settings);
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
  const issue = workflow.issues.find((item) => item.issueId === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found in workflow ${displayWorkflowCode(workflow)}`);
  const qaPrUrl = qaContext.prUrl ?? issue.prUrl ?? null;
  const qaHeadSha = qaContext.headSha ?? null;
  if (!project?.githubRepo || !issue.githubIssueNumber || !qaPrUrl) throw new Error(`Issue ${issueId} is missing GitHub PR context for QA`);

  workflow.status = "in_progress";
  workflow.timeline.push(`QA started for issue ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const issueOwnedPaths = issue.ownedPaths ?? [];
  const qaStartedAt = new Date().toISOString();
  if (workflow.projectId) {
    await appendAgentMessages({
      sessionKey: issue.qaSessionId ?? `${issue.issueId}:qa`,
      projectId: workflow.projectId,
      role: "qa",
      title: `QA: ${issue.title}`,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      ownedPaths: issueOwnedPaths,
      status: "active",
      currentStep: "QA validating PR",
      startedAt: qaStartedAt,
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      prUrl: qaPrUrl,
      labels: ["taskix:need-qa", "taskix:qa-running"],
      messages: [
        { role: "user", content: `Validate PR ${qaPrUrl} for issue #${issue.githubIssueNumber}: ${issue.title}${qaHeadSha ? `\nExpected head SHA: ${qaHeadSha}` : ""}`, createdAt: qaStartedAt }
      ]
    });
  }

  const qaResult = await codex.qaReviewPr({
    repo: project.githubRepo,
    issueNumber: issue.githubIssueNumber,
    prUrl: qaPrUrl,
    headSha: qaHeadSha
  });
  const qaFinishedAt = new Date().toISOString();
  const qaFailureType = qaResult.passed ? "none" : qaResult.failureType;
  const qaCloseAt = qaResult.passed ? qaFinishedAt : null;
  const appliedLabels = qaResult.passed
    ? ["taskix:qa-passed"]
    : qaFailureType === "spec"
      ? ["taskix:spec-blocked", "taskix:blocked"]
      : ["taskix:qa-failed"];
  const qaStateLabels = ["qa-passed", "taskix:need-qa", "taskix:qa-running", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:spec-blocked", "taskix:ready-to-merge"];
  await publishQaResultToGitHub(project.githubRepo, issue, qaPrUrl, qaResult, appliedLabels, qaStateLabels);
  issue.labels = [...new Set([...(issue.labels ?? []).filter((label) => !qaStateLabels.includes(label.toLowerCase())), ...appliedLabels])];
  issue.prLabels = [...new Set([...(issue.prLabels ?? []).filter((label) => !qaStateLabels.includes(label.toLowerCase())), ...appliedLabels])];

  if (workflow.projectId) {
    await appendAgentMessages({
      sessionKey: issue.qaSessionId ?? `${issue.issueId}:qa`,
      projectId: workflow.projectId,
      role: "qa",
      title: `QA: ${issue.title}`,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      ownedPaths: issueOwnedPaths,
      status: qaResult.passed ? "done" : "blocked",
      currentStep: qaResult.passed ? "QA passed" : qaFailureType === "spec" ? "QA blocked by issue specification" : "QA failed",
      startedAt: qaStartedAt,
      finishedAt: qaFinishedAt,
      durationMs: Math.max(0, new Date(qaFinishedAt).getTime() - new Date(qaStartedAt).getTime()),
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      prUrl: qaPrUrl,
      labels: appliedLabels,
      closedAt: qaCloseAt,
      archivedAt: qaCloseAt,
      executionLogs: qaResult.executionLog ? [{
        title: `QA Codex execution for ${issue.title}`,
        content: qaResult.executionLog,
        createdAt: qaFinishedAt,
        status: qaResult.passed ? "ok" : "failed",
        durationMs: Math.max(0, new Date(qaFinishedAt).getTime() - new Date(qaStartedAt).getTime())
      }] : [],
      messages: [
        { role: "assistant", content: `Passed: ${qaResult.passed}\nFailure type: ${qaResult.failureType}\n${qaResult.summary}\nFindings:\n${qaResult.findings.map((finding) => `- ${finding}`).join("\n") || "- none"}\nLabels: ${appliedLabels.join(", ")}`, createdAt: new Date().toISOString() }
      ]
    });
  }

  workflow.timeline.push(qaResult.passed
    ? `QA passed PR for issue ${issue.issueId}. Awaiting architect merge handoff.`
    : qaFailureType === "spec"
      ? `QA marked ${issue.issueId} spec-blocked for architect clarification: ${qaResult.summary}`
      : `QA failed PR for issue ${issue.issueId}: ${qaResult.summary}`);
  workflow.status = deriveWorkflowStatus(workflow);
  if (!qaResult.passed) workflow.status = "blocked";
  await saveWorkflow(workflow);
  if (project) await saveProject(project);
  return workflow;
}

export async function syncWorkflowFromGitHub(workflowId: string, project?: ProjectRecord | null): Promise<WorkflowRecord> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
  if (!project?.githubRepo) {
    workflow.timeline.push("GitHub sync skipped: workflow has no bound project repo.");
    await saveWorkflow(workflow);
    return workflow;
  }

  const before = JSON.stringify(workflow.issues.map((issue) => ({
    issueId: issue.issueId,
    labels: issue.labels,
    prUrl: issue.prUrl,
    prLabels: issue.prLabels,
    prState: issue.prState
  })));

  for (const issue of workflow.issues) {
    if (!issue.githubIssueNumber) continue;
    const snapshot = await getIssueSnapshotWithGh(project.githubRepo, issue.githubIssueNumber);
    const primaryPr = choosePrimaryPr(snapshot.linkedPrs, issue.prUrl ?? null);
    issue.githubIssueUrl = snapshot.url;
    issue.githubState = snapshot.state;
    issue.labels = snapshot.labels;
    issue.prUrl = primaryPr?.url ?? null;
    issue.prState = primaryPr?.state ?? null;
    issue.prLabels = primaryPr?.labels ?? [];
    const now = new Date().toISOString();
    if (workflow.projectId && issue.developerSessionId) {
      await appendAgentMessages({
        sessionKey: issue.developerSessionId,
        projectId: workflow.projectId,
        role: "developer",
        title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
        workflowId: workflow.workflowId,
        issueId: issue.issueId,
        developerRole: issue.developerRole ?? "general_developer",
        ownedPaths: issue.ownedPaths,
        githubIssueNumber: issue.githubIssueNumber,
        githubIssueUrl: snapshot.url,
        prUrl: primaryPr?.url ?? issue.prUrl ?? null,
        labels: [...snapshot.labels, ...(primaryPr?.labels ?? [])],
        lastSyncedAt: now,
        messages: []
      });
    }
    const combinedLabels = [...new Set([...snapshot.labels, ...(primaryPr?.labels ?? [])])];
    const qaStatus = deriveQaSessionStatus(combinedLabels);
    if (workflow.projectId && issue.qaSessionId && primaryPr && qaStatus) {
      const finishedAt = qaStatus === "active" ? null : now;
      await appendAgentMessages({
        sessionKey: issue.qaSessionId,
        projectId: workflow.projectId,
        role: "qa",
        title: `QA: ${issue.title}`,
        workflowId: workflow.workflowId,
        issueId: issue.issueId,
        ownedPaths: issue.ownedPaths,
        githubIssueNumber: issue.githubIssueNumber,
        githubIssueUrl: snapshot.url,
        prUrl: primaryPr.url,
        labels: combinedLabels,
        lastSyncedAt: now,
        status: qaStatus,
        currentStep: qaStatus === "done" ? "QA passed" : qaStatus === "blocked" ? "QA failed" : "QA validating PR",
        finishedAt,
        closedAt: qaStatus === "done" ? now : null,
        archivedAt: qaStatus === "done" ? now : null,
        messages: []
      });
    }
  }

  workflow.status = deriveWorkflowStatus(workflow);
  const after = JSON.stringify(workflow.issues.map((issue) => ({
    issueId: issue.issueId,
    labels: issue.labels,
    prUrl: issue.prUrl,
    prLabels: issue.prLabels,
    prState: issue.prState
  })));
  if (before !== after) {
    workflow.timeline.push(`Synced GitHub issue/PR labels at ${new Date().toISOString()}.`);
  } else {
    workflow.timeline.push(`GitHub sync checked at ${new Date().toISOString()}; no label changes detected.`);
  }

  await saveWorkflow(workflow);
  return workflow;
}

async function runIssue(issue: IssueRecord, workflow: WorkflowRecord, codex: CodexClient, createIssue: (issue: IssueSpec) => Promise<{ number: number | null; htmlUrl: string | null; mock: boolean }>, project?: ProjectRecord | null): Promise<{
  timeline: string[];
  releaseNote: Record<string, string | boolean>;
  blocked: boolean;
}> {
  const issueOwnedPaths = issue.ownedPaths ?? [];
  const ownedPaths = issueOwnedPaths.length ? issueOwnedPaths.join(", ") : "unspecified";
  const timeline = [`Developer role ${issue.developerRole ?? issue.assigneeRole} started GitHub issue #${issue.githubIssueNumber ?? issue.issueId} with ownership: ${ownedPaths}.`];

  if (!project?.githubRepo || !issue.githubIssueNumber) {
    const followUp = await createIssue({
      title: `Blocked: ${issue.title}`,
      description: `Taskix could not start developer execution because this workflow issue has no bound GitHub repo or issue number.`,
      assigneeRole: "developer",
      developerRole: "general_developer",
      ownedPaths: [],
      acceptanceCriteria: ["Workflow issue has a GitHub issue number before developer execution starts"]
    });
    timeline.push(`Developer execution blocked; opened follow-up issue ${followUp.number ?? "local-only"}.`);
    return {
      timeline,
      releaseNote: {
        issueId: issue.issueId,
        issueTitle: issue.title,
        blocked: true,
        reason: "Missing GitHub repo or issue number"
      },
      blocked: true
    };
  }

  const developerStartedAt = new Date().toISOString();
  if (workflow.projectId) {
    await appendAgentMessages({
      sessionKey: issue.developerSessionId ?? `${issue.issueId}:developer`,
      projectId: workflow.projectId,
      role: "developer",
      title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      developerRole: issue.developerRole ?? "general_developer",
      ownedPaths: issueOwnedPaths,
      status: "active",
      currentStep: "developer handling GitHub issue",
      startedAt: developerStartedAt,
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      labels: ["taskix:dev-running"],
      messages: [
        { role: "system", content: `Owned paths: ${ownedPaths}`, createdAt: developerStartedAt },
        { role: "user", content: `Handle GitHub issue #${issue.githubIssueNumber}: ${issue.title}`, createdAt: developerStartedAt }
      ]
    });
  }

  const developerResult = await codex.developerHandleIssue({
    repo: project.githubRepo,
    issueNumber: issue.githubIssueNumber,
    issue,
    workflowId: displayWorkflowCode(workflow),
    activePrUrl: issue.prUrl ?? null,
    activeBranch: issue.branch ?? null,
    returnedFromQa: includesAny([...(issue.labels ?? []), ...(issue.prLabels ?? [])], ["taskix:qa-failed", "qa-failed", "taskix:blocked", "taskix:dev-running"])
  });
  if (!developerResult.prUrl) {
    const recovery = await recoverDeveloperPullRequest(project.githubRepo, issue, workflow, developerResult.branch);
    if (recovery) {
      developerResult.prUrl = recovery.prUrl;
      developerResult.branch = recovery.branch;
      developerResult.summary = `${developerResult.summary}\n\nTaskix recovered existing PR context after developer publishing returned empty.\nRecovery source: ${recovery.source}.\nRecovered base: ${recovery.base ?? "repository default branch"}.`;
      timeline.push(`Recovered existing PR context for issue ${issue.issueId} via ${recovery.source}; base ${recovery.base ?? "repository default branch"}.`);
    }
  }
  if (!developerResult.prUrl && developerResult.branch) {
    try {
      developerResult.prUrl = await createDeveloperPullRequest(project.githubRepo, issue, workflow, developerResult);
      timeline.push(`Taskix created PR ${developerResult.prUrl} for issue ${issue.issueId} from branch ${developerResult.branch}.`);
    } catch (error) {
      developerResult.summary = `${developerResult.summary}\n\nTaskix server could not create a PR from branch ${developerResult.branch}: ${error instanceof Error ? error.message : String(error)}`;
      timeline.push(`Taskix server could not create PR for issue ${issue.issueId} from branch ${developerResult.branch}.`);
    }
  }
  const previousPrUrl = issue.prUrl ?? null;
  if (previousPrUrl && developerResult.prUrl && previousPrUrl !== developerResult.prUrl && project?.githubRepo) {
    try {
      await addLabelsWithGh(project.githubRepo, previousPrUrl, ["taskix:superseded"]);
      timeline.push(`Marked previous PR ${previousPrUrl} superseded because developer returned ${developerResult.prUrl}.`);
    } catch {
      timeline.push(`Developer returned a replacement PR ${developerResult.prUrl}; previous PR ${previousPrUrl} could not be marked superseded.`);
    }
  }
  issue.prUrl = developerResult.prUrl || null;
  issue.branch = developerResult.branch || null;
  if (developerResult.prUrl) {
    try {
      await publishDeveloperPrStateToGitHub(project.githubRepo, issue, developerResult.prUrl);
      timeline.push(`Taskix updated GitHub labels for issue ${issue.issueId} after developer PR completion.`);
    } catch (error) {
      timeline.push(`Taskix could not update GitHub labels for issue ${issue.issueId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (workflow.projectId) {
    const finishedAt = new Date().toISOString();
    const closeAt = developerResult.prUrl ? finishedAt : null;
    await appendAgentMessages({
      sessionKey: issue.developerSessionId ?? `${issue.issueId}:developer`,
      projectId: workflow.projectId,
      role: "developer",
      title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      developerRole: issue.developerRole ?? "general_developer",
      ownedPaths: issueOwnedPaths,
      status: developerResult.prUrl ? "done" : "blocked",
      currentStep: developerResult.prUrl ? "developer completed PR" : "developer blocked",
      startedAt: developerStartedAt,
      finishedAt,
      durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(developerStartedAt).getTime()),
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      prUrl: developerResult.prUrl || null,
      labels: developerResult.prUrl ? ["taskix:pr-opened"] : ["taskix:blocked"],
      closedAt: closeAt,
      archivedAt: closeAt,
      executionLogs: developerResult.executionLog ? [{
        title: `Developer Codex execution for ${issue.title}`,
        content: developerResult.executionLog,
        createdAt: finishedAt,
        status: developerResult.prUrl ? "ok" : "failed",
        durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(developerStartedAt).getTime())
      }] : [],
      messages: [
        { role: "assistant", content: `Summary: ${developerResult.summary}\nBranch: ${developerResult.branch || "none"}\nPR: ${developerResult.prUrl || "none"}\nTests: ${developerResult.testsRun.join(", ") || "none"}`, createdAt: new Date().toISOString() }
      ]
    });
  }
  timeline.push(developerResult.prUrl ? `Developer opened PR ${developerResult.prUrl} for issue ${issue.issueId}.` : `Developer did not return a PR for issue ${issue.issueId}.`);

  if (!developerResult.prUrl) {
    return {
      timeline,
      releaseNote: {
        issueId: issue.issueId,
        issueTitle: issue.title,
        developerRole: issue.developerRole ?? issue.assigneeRole,
        ownedPaths,
        developerSummary: developerResult.summary,
        blocked: true,
        reason: "Developer did not return PR URL"
      },
      blocked: true
    };
  }

  const developerCompletionCleanupLabels = ["taskix:dev-running", "qa-passed", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:spec-blocked", "taskix:architect-review", "taskix:ready-to-merge", "taskix:blocked"];
  issue.labels = [...new Set([...(issue.labels ?? []).filter((label) => !developerCompletionCleanupLabels.includes(label.toLowerCase())), "taskix:pr-opened"])];
  issue.prLabels = [...new Set([...(issue.prLabels ?? []).filter((label) => !developerCompletionCleanupLabels.includes(label.toLowerCase())), "taskix:pr-opened"])];
  timeline.push(`Developer completed PR for issue ${issue.issueId}. Awaiting QA handoff.`);
  return {
    timeline,
    releaseNote: {
      issueId: issue.issueId,
      issueTitle: issue.title,
      developerRole: issue.developerRole ?? issue.assigneeRole,
      ownedPaths,
      developerSummary: developerResult.summary,
      prUrl: developerResult.prUrl,
      qaPassed: false,
      qaSummary: "QA handoff pending.",
      architectDecision: "need_qa",
      architectSummary: "Developer completed PR; waiting for explicit QA handoff."
    },
    blocked: false
  };

}

function createIssueCreator(project: ProjectRecord | null | undefined, settings: Awaited<ReturnType<typeof getSettings>>) {
  if (project?.githubRepo) {
    return (issue: IssueSpec) => createIssueWithGh(project.githubRepo, issue);
  }
  const github = new GitHubClient(settings.githubToken, settings.githubRepo, settings.githubApiUrl);
  return (issue: IssueSpec) => github.createIssue(issue);
}

function choosePrimaryPr(prs: Array<{ url: string; state: string; labels: string[] }>, preferredPrUrl?: string | null): { url: string; state: string; labels: string[] } | null {
  if (!prs.length) return null;
  const preferred = preferredPrUrl ? prs.find((pr) => pr.url === preferredPrUrl) : null;
  if (preferred && !preferred.labels.map((label) => label.toLowerCase()).includes("taskix:superseded")) return preferred;
  const active = prs.filter((pr) => !pr.labels.map((label) => label.toLowerCase()).includes("taskix:superseded"));
  return active.find((pr) => pr.state === "OPEN") ?? active[0] ?? prs.find((pr) => pr.state === "OPEN") ?? prs[0];
}

async function queueReadyDeveloperJobs(projectId: string, workflow: WorkflowRecord): Promise<number> {
  const jobs = await listJobs(projectId);
  let queued = 0;
  for (const issue of workflow.issues) {
    if (!isDeveloperIssueReady(issue, workflow.issues)) continue;
    const existing = jobs.some((job) => (
      job.type === "issue_run"
      && job.status !== "cancelled"
      && job.payload.workflowId === workflow.workflowId
      && job.payload.issueId === issue.issueId
    ));
    if (existing) continue;
    await createJob({
      projectId,
      type: "issue_run",
      payload: { workflowId: workflow.workflowId, issueId: issue.issueId }
    });
    queued += 1;
  }
  return queued;
}

function isDeveloperIssueReady(issue: IssueRecord, issues: IssueRecord[]): boolean {
  const labels = [...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase());
  if (issue.prUrl || issue.prState === "MERGED") return false;
  if (labels.some((label) => ["taskix:dev-running", "taskix:pr-opened", "taskix:need-qa", "taskix:qa-running", "taskix:qa-passed", "taskix:ready-to-merge", "taskix:merged"].includes(label))) return false;
  const dependencies = issue.dependsOn ?? [];
  if (!dependencies.length) return true;
  return dependencies.every((dependency) => {
    const normalized = dependency.trim().toLowerCase();
    const upstream = issues.find((candidate) => (
      candidate.issueId.toLowerCase() === normalized
      || candidate.title.toLowerCase() === normalized
      || String(candidate.githubIssueNumber ?? "") === normalized.replace(/^#/, "")
    ));
    if (!upstream) return false;
    const upstreamLabels = [...(upstream.labels ?? []), ...(upstream.prLabels ?? [])].map((label) => label.toLowerCase());
    return upstream.prState === "MERGED" || upstreamLabels.some((label) => label === "taskix:merged" || label === "taskix:deployed");
  });
}

function deriveQaSessionStatus(labels: string[]): "active" | "blocked" | "done" | null {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  if (normalizedLabels.includes("taskix:qa-passed")) return "done";
  if (normalizedLabels.includes("taskix:qa-failed") || normalizedLabels.includes("taskix:spec-blocked")) return "blocked";
  if (normalizedLabels.includes("taskix:need-qa") || normalizedLabels.includes("taskix:qa-running")) return "active";
  return null;
}

async function createDeveloperPullRequest(repo: string, issue: IssueRecord, workflow: WorkflowRecord, developerResult: DeveloperIssueResult): Promise<string> {
  const issueNumber = issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : issue.issueId;
  const body = [
    `Taskix workflow: ${displayWorkflowCode(workflow)}`,
    `Issue: ${issueNumber}`,
    "",
    "## Summary",
    developerResult.summary,
    "",
    "## Changed Files",
    developerResult.changedFiles.length ? developerResult.changedFiles.map((file) => `- ${file}`).join("\n") : "- none reported",
    "",
    "## Verification",
    developerResult.testsRun.length ? developerResult.testsRun.map((test) => `- ${test}`).join("\n") : "- none reported",
    "",
    issue.githubIssueNumber ? `Closes #${issue.githubIssueNumber}` : ""
  ].filter(Boolean).join("\n");

  return createPullRequestWithGh({
    repo,
    head: developerResult.branch,
    base: expectedDeveloperBaseBranch(),
    title: issue.title,
    body,
    labels: ["taskix:pr-opened", "taskix:architect-review", issue.developerRole ? `role:${issue.developerRole}` : ""].filter(Boolean)
  });
}

async function publishDeveloperPrStateToGitHub(repo: string, issue: IssueRecord, prUrl: string): Promise<void> {
  const labelsToApply = ["taskix:pr-opened", "taskix:architect-review", issue.developerRole ? `role:${issue.developerRole}` : ""].filter((label): label is string => Boolean(label));
  const labelsToClear = ["taskix:dev-running", "qa-passed", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:spec-blocked", "taskix:ready-to-merge", "taskix:blocked"];
  if (issue.githubIssueNumber) {
    await removeLabelsWithGh(repo, issue.githubIssueNumber, labelsToRemove(issue.labels ?? [], labelsToClear, labelsToApply));
    await addLabelsWithGh(repo, issue.githubIssueNumber, labelsToApply);
  }
  await removeLabelsWithGh(repo, prUrl, labelsToRemove(issue.prLabels ?? [], labelsToClear, labelsToApply));
  await addLabelsWithGh(repo, prUrl, labelsToApply);
}

async function publishQaResultToGitHub(
  repo: string,
  issue: IssueRecord,
  prUrl: string,
  qaResult: QaPrReviewResult,
  appliedLabels: string[],
  qaStateLabels: string[]
): Promise<void> {
  const body = [
    `QA ${qaResult.passed ? "passed" : qaResult.failureType === "spec" ? "blocked on specification" : "failed"} for ${issue.githubIssueNumber ? `issue #${issue.githubIssueNumber}` : issue.issueId}.`,
    "",
    "## Summary",
    `Failure type: ${qaResult.failureType}`,
    "",
    qaResult.summary,
    "",
    "## Findings",
    qaResult.findings.length ? qaResult.findings.map((finding) => `- ${finding}`).join("\n") : "- none",
    "",
    "## Commands",
    qaResult.testsRun.length ? qaResult.testsRun.map((test) => `- ${test}`).join("\n") : "- none reported"
  ].join("\n");

  if (issue.githubIssueNumber) {
    await removeLabelsWithGh(repo, issue.githubIssueNumber, labelsToRemove(issue.labels ?? [], qaStateLabels, appliedLabels));
    await addLabelsWithGh(repo, issue.githubIssueNumber, appliedLabels);
    await commentIssueWithGh(repo, issue.githubIssueNumber, body);
  }
  await removeLabelsWithGh(repo, prUrl, labelsToRemove(issue.prLabels ?? [], qaStateLabels, appliedLabels));
  await addLabelsWithGh(repo, prUrl, appliedLabels);
  await commentPullRequestWithGh(repo, prUrl, body);
}

function labelsToRemove(existingLabels: string[], candidateLabels: string[], keepLabels: string[]): string[] {
  const existing = new Set(existingLabels.map((label) => label.toLowerCase()));
  const keep = new Set(keepLabels.map((label) => label.toLowerCase()));
  return candidateLabels.filter((label) => existing.has(label.toLowerCase()) && !keep.has(label.toLowerCase()));
}

async function recoverDeveloperPullRequest(
  repo: string,
  issue: IssueRecord,
  workflow: WorkflowRecord,
  branch: string
): Promise<{ prUrl: string; branch: string; base: string | null; source: string } | null> {
  try {
    const branchCandidates = prRecoveryBranches({
      developerBranch: branch,
      workflowCode: displayWorkflowCode(workflow),
      issueNumberOrId: issue.githubIssueNumber ?? issue.issueId
    });

    for (const candidateBranch of branchCandidates) {
      const existingPrUrl = await findPullRequestByHeadWithGh(repo, candidateBranch);
      if (!existingPrUrl) continue;
      const details = await readPullRequestRefs(repo, existingPrUrl);
      if (!isRecoverablePrBase(details.base, expectedDeveloperBaseBranch())) continue;
      return {
        prUrl: existingPrUrl,
        branch: details.head ?? candidateBranch,
        base: details.base,
        source: branch && candidateBranch === branch ? "developer branch lookup" : "expected workflow branch lookup"
      };
    }

    if (!issue.githubIssueNumber) return null;
    const snapshot = await getIssueSnapshotWithGh(repo, issue.githubIssueNumber);
    const linkedPr = choosePrimaryPr(snapshot.linkedPrs, issue.prUrl ?? null);
    if (!linkedPr) return null;
    const details = await readPullRequestRefs(repo, linkedPr.url);
    if (!isRecoverablePrBase(details.base, expectedDeveloperBaseBranch())) return null;
    return {
      prUrl: linkedPr.url,
      branch: details.head ?? expectedDeveloperBranch(displayWorkflowCode(workflow), issue.githubIssueNumber ?? issue.issueId),
      base: details.base,
      source: "linked issue pull request lookup"
    };
  } catch {
    return null;
  }
}

async function readPullRequestRefs(repo: string, pr: string): Promise<{ head: string | null; base: string | null; state: string | null; merged: boolean }> {
  try {
    const { stdout } = await execFileAsync("gh", ["pr", "view", pr, "--repo", repo, "--json", "headRefName,baseRefName,state,mergedAt"]);
    const payload = JSON.parse(stdout) as { headRefName?: string; baseRefName?: string; state?: string; mergedAt?: string | null };
    return {
      head: payload.headRefName?.trim() || null,
      base: payload.baseRefName?.trim() || null,
      state: payload.state?.trim() || null,
      merged: Boolean(payload.mergedAt)
    };
  } catch {
    return { head: null, base: null, state: null, merged: false };
  }
}

function deriveWorkflowStatus(workflow: WorkflowRecord): WorkflowRecord["status"] {
  if (!workflow.issues.length) return workflow.status;
  const issues = workflow.issues;
  const hasBlocked = issues.some((issue) => includesAny([...(issue.labels ?? []), ...(issue.prLabels ?? [])], ["taskix:blocked", "taskix:qa-failed", "taskix:spec-blocked"]));
  if (hasBlocked) return "blocked";
  const allDone = issues.every((issue) => includesAny([...(issue.labels ?? []), ...(issue.prLabels ?? [])], ["taskix:merged", "taskix:deployed"]) || issue.prState === "MERGED");
  if (allDone) return "done";
  const anyProgress = issues.some((issue) => includesAny([...(issue.labels ?? []), ...(issue.prLabels ?? [])], ["taskix:dev-running", "taskix:pr-opened", "taskix:architect-review", "taskix:need-qa", "taskix:qa-running", "taskix:qa-passed", "taskix:ready-to-merge"]));
  return anyProgress ? "in_progress" : workflow.status;
}

function includesAny(values: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => values.includes(candidate));
}

export function formatWorkflow(workflow: WorkflowRecord): string {
  const lines = [
    `Workflow ${displayWorkflowCode(workflow)}`,
    `Status: ${workflow.status}`,
    `Project: ${workflow.projectName ?? "default"}`,
    `Requirement: ${workflow.userRequirement}`,
    "",
    "Issues:"
  ];
  if (!workflow.issues.length) lines.push("- none");
  for (const issue of workflow.issues) {
    const role = issue.developerRole ?? issue.assigneeRole;
    const ownedPaths = issue.ownedPaths ?? [];
    const paths = ownedPaths.length ? ` paths: ${ownedPaths.join(", ")}` : "";
    lines.push(`- ${issue.issueId}: ${issue.title} [${role}]${paths} (${issue.githubIssueNumber ? `GitHub #${issue.githubIssueNumber}` : "local-only"})`);
  }
  lines.push("", "Timeline:", ...workflow.timeline.slice(-10).map((item) => `- ${item}`));
  return lines.join("\n");
}

function displayWorkflowCode(workflow: WorkflowRecord): string {
  return workflow.trackingCode ?? workflow.workflowId;
}
