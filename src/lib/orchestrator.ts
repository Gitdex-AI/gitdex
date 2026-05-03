import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { agentJobMessageId } from "@/lib/agent-run-messages";
import { CodexClient } from "@/lib/codex";
import { developerRoleIds, type DeveloperRoleId } from "@/lib/developer-roles";
import { GitHubClient } from "@/lib/github";
import { addLabelsWithGh, commentIssueWithGh, commentPullRequestWithGh, createIssueWithGh, createPullRequestWithGh, findPullRequestByHeadWithGh, getIssueSnapshotWithGh, removeLabelsWithGh, updateIssueWithGh } from "@/lib/github-local";
import { findDependencyIssue, isDependencySatisfied, normalizeIssueDependenciesToNumbers } from "@/lib/issue-dependencies";
import { expectedDeveloperBaseBranch, expectedDeveloperBranch, isRecoverablePrBase, prRecoveryBranches } from "@/lib/issue-run-policy";
import { getActiveJobId } from "@/lib/job-runtime";
import { qaValidationInstruction } from "@/lib/qa-validation-instruction";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, cancelPendingJobs, createJob, getAgentSession, getJob, listJobs, listWorkflows, saveProject, saveWorkflow, getWorkflow } from "@/lib/store";
import type { DeveloperIssueResult, IssueRecord, IssueSpec, ProjectRecord, QaPrReviewResult, WorkflowRecord } from "@/lib/types";
import { deriveWorkflowStatus } from "@/lib/workflow-status";
import { rebuildDeveloperWorktree } from "@/lib/worktree-manager";

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

  const plan = await codex.architectPlanIssues(workflow.userRequirement);
  const issues = plan.issues;
  workflow.issues = [];
  workflow.status = "transferred_to_github";
  workflow.timeline.push("PM confirmed scope and handed requirement to planner.");
  workflow.timeline.push("Planner generated implementation issue breakdown.");
  if (project?.projectId) {
    const plannerInstruction = plannerWorkflowInstruction(workflow);
    const existingPlannerSession = await getAgentSession(`${workflow.workflowId}:planner`);
    const finishedAt = new Date().toISOString();
    const startedAt = existingPlannerSession?.startedAt ?? existingPlannerSession?.messages.find((message) => message.status === "running" || message.status === "pending")?.createdAt ?? finishedAt;
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
    const activeJobId = getActiveJobId();
    await appendAgentMessages({
      sessionKey: `${workflow.workflowId}:planner`,
      projectId: project.projectId,
      role: "planner",
      title: "Planner",
      workflowId: workflow.workflowId,
      status: "done",
      currentStep: "planner created GitHub issues",
      finishedAt,
      durationMs,
      messages: [
        ...(hasAgentMessage(existingPlannerSession, plannerInstruction) ? [] : [{
          role: "user" as const,
          content: plannerInstruction,
          createdAt: new Date().toISOString()
        }]),
        {
          messageId: activeJobId ? agentJobMessageId(activeJobId) : undefined,
          jobId: activeJobId,
          role: "assistant",
          status: "done" as const,
          durationMs,
          executionLogs: plan.executionLog ? [{
            title: `Planner Codex execution for ${displayWorkflowCode(workflow)}`,
            content: plan.executionLog,
            createdAt: finishedAt,
            status: "ok" as const,
            durationMs
          }] : [],
          content: `Planner created ${issues.length} implementation issue(s):\n\n${issues.map((issue, index) => {
            const ownedPaths = issue.ownedPaths.length ? issue.ownedPaths.join(", ") : "unspecified";
            return `${index + 1}. ${issue.title}\nDeveloper role: ${issue.developerRole ?? issue.assigneeRole}\nOwned paths: ${ownedPaths}\nAcceptance criteria:\n${issue.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`;
          }).join("\n\n")}`,
          createdAt: finishedAt,
          updatedAt: finishedAt
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
  const normalizedDependencies = normalizeIssueDependenciesToNumbers(workflow.issues);
  if (project?.githubRepo && normalizedDependencies) {
    await Promise.all(workflow.issues
      .filter((issue) => issue.githubIssueNumber)
      .map((issue) => updateIssueWithGh(project.githubRepo, issue.githubIssueNumber as number, issue)));
    workflow.timeline.push(`Normalized issue dependencies to GitHub issue numbers for ${normalizedDependencies} issue(s).`);
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
  const qaInstruction = qaValidationInstruction(qaPrUrl, issue, qaHeadSha);
  if (workflow.projectId) {
    const existingQaSession = await getAgentSession(issue.qaSessionId ?? `${issue.issueId}:qa`);
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
      messages: hasAgentMessage(existingQaSession, qaInstruction) ? [] : [
        { role: "user", content: qaInstruction, createdAt: qaStartedAt }
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
      : qaFailureType === "environment"
        ? ["taskix:env-blocked", "taskix:blocked"]
        : ["taskix:qa-failed"];
  const qaStateLabels = ["qa-passed", "taskix:need-qa", "taskix:qa-running", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:spec-blocked", "taskix:env-blocked", "taskix:ready-to-merge"];
  await publishQaResultToGitHub(project.githubRepo, issue, qaPrUrl, qaResult, appliedLabels, qaStateLabels);
  issue.labels = [...new Set([...(issue.labels ?? []).filter((label) => !qaStateLabels.includes(label.toLowerCase())), ...appliedLabels])];
  issue.prLabels = [...new Set([...(issue.prLabels ?? []).filter((label) => !qaStateLabels.includes(label.toLowerCase())), ...appliedLabels])];

  if (workflow.projectId) {
    const activeJobId = getActiveJobId();
    const durationMs = Math.max(0, new Date(qaFinishedAt).getTime() - new Date(qaStartedAt).getTime());
    await appendAgentMessages({
      sessionKey: issue.qaSessionId ?? `${issue.issueId}:qa`,
      projectId: workflow.projectId,
      role: "qa",
      title: `QA: ${issue.title}`,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      ownedPaths: issueOwnedPaths,
      status: qaResult.passed ? "done" : "blocked",
      currentStep: qaResult.passed ? "QA passed" : qaFailureType === "spec" ? "QA blocked by issue specification" : qaFailureType === "environment" ? "QA blocked by environment" : "QA failed",
      startedAt: qaStartedAt,
      finishedAt: qaFinishedAt,
      durationMs,
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      prUrl: qaPrUrl,
      labels: appliedLabels,
      closedAt: qaCloseAt,
      archivedAt: qaCloseAt,
      executionLogs: [],
      messages: [
        {
          messageId: activeJobId ? agentJobMessageId(activeJobId) : undefined,
          jobId: activeJobId,
          role: "assistant",
          status: qaResult.passed ? "done" : "blocked",
          durationMs,
          executionLogs: qaResult.executionLog ? [{
            title: `QA Codex execution for ${issue.title}`,
            content: qaResult.executionLog,
            createdAt: qaFinishedAt,
            status: qaResult.passed ? "ok" : "failed",
            durationMs
          }] : [],
          content: `Passed: ${qaResult.passed}\nFailure type: ${qaResult.failureType}\n${qaResult.summary}\nFindings:\n${qaResult.findings.map((finding) => `- ${finding}`).join("\n") || "- none"}\nLabels: ${appliedLabels.join(", ")}`,
          createdAt: qaFinishedAt,
          updatedAt: qaFinishedAt
        }
      ]
    });
  }

  workflow.timeline.push(qaResult.passed
    ? `QA passed PR for issue ${issue.issueId}. Awaiting review and merge handoff.`
    : qaFailureType === "spec"
      ? `QA marked ${issue.issueId} spec-blocked for architect clarification: ${qaResult.summary}`
      : qaFailureType === "environment"
        ? `QA marked ${issue.issueId} environment-blocked: ${qaResult.summary}`
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
    issue.developerRole = roleFromLabels([...snapshot.labels, ...(primaryPr?.labels ?? [])]) ?? issue.developerRole;
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

  if (project?.projectId) {
    const queued = await queueReadyDeveloperJobs(project.projectId, workflow);
    if (queued) workflow.timeline.push(`Queued ${queued} dependent developer issue job(s) after GitHub sync.`);
  }

  await saveWorkflow(workflow);
  return workflow;
}

function roleFromLabels(labels: string[]): DeveloperRoleId | null {
  const roleLabel = labels.map((label) => label.toLowerCase()).find((label) => label.startsWith("role:"));
  const role = roleLabel?.slice("role:".length) ?? "";
  return developerRoleIds.includes(role as DeveloperRoleId) ? role as DeveloperRoleId : null;
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
  const developerInstruction = developerIssueInstruction(issue);
  if (workflow.projectId) {
    const existingDeveloperSession = await getAgentSession(issue.developerSessionId ?? `${issue.issueId}:developer`);
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
      messages: hasAgentMessage(existingDeveloperSession, developerInstruction) ? [] : [
        { role: "user", content: developerInstruction, createdAt: developerStartedAt }
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
  if (developerResult.prUrl && !isPullRequestUrl(developerResult.prUrl)) {
    timeline.push(`Developer returned a non-PR URL for issue ${issue.issueId}; Taskix will create or recover the pull request from branch ${developerResult.branch || "unknown"}.`);
    developerResult.prUrl = "";
  }
  if (!developerResult.prUrl && developerResult.blockedType === "none") {
    const recovery = await recoverDeveloperPullRequest(project.githubRepo, issue, workflow, developerResult.branch);
    if (recovery) {
      developerResult.prUrl = recovery.prUrl;
      developerResult.branch = recovery.branch;
      developerResult.summary = `${developerResult.summary}\n\nTaskix recovered existing PR context after developer publishing returned empty.\nRecovery source: ${recovery.source}.\nRecovered base: ${recovery.base ?? "repository default branch"}.`;
      timeline.push(`Recovered existing PR context for issue ${issue.issueId} via ${recovery.source}; base ${recovery.base ?? "repository default branch"}.`);
    }
  }
  if (!developerResult.prUrl && developerResult.branch && developerResult.blockedType === "none") {
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
    const blockedLabels = developerResult.blockedType === "spec"
      ? ["taskix:spec-blocked", "taskix:blocked"]
      : developerResult.blockedType === "environment"
        ? ["taskix:env-blocked", "taskix:blocked"]
        : ["taskix:blocked"];
    const activeJobId = getActiveJobId();
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(developerStartedAt).getTime());
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
      durationMs,
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      prUrl: developerResult.prUrl || null,
      labels: developerResult.prUrl ? ["taskix:architect-review", issue.developerRole ? `role:${issue.developerRole}` : "role:general_developer"] : blockedLabels,
      closedAt: closeAt,
      archivedAt: closeAt,
      executionLogs: [],
      messages: [
        {
          messageId: activeJobId ? agentJobMessageId(activeJobId) : undefined,
          jobId: activeJobId,
          role: "assistant",
          status: developerResult.prUrl ? "done" : "blocked",
          durationMs,
          executionLogs: developerResult.executionLog ? [{
            title: `Developer Codex execution for ${issue.title}`,
            content: developerResult.executionLog,
            createdAt: finishedAt,
            status: developerResult.prUrl ? "ok" : "failed",
            durationMs
          }] : [],
          content: `Summary: ${developerResult.summary}\nBlocked type: ${developerResult.blockedType}\nBranch: ${developerResult.branch || "none"}\nPR: ${developerResult.prUrl || "none"}\nTests: ${developerResult.testsRun.join(", ") || "none"}`,
          createdAt: finishedAt,
          updatedAt: finishedAt
        }
      ]
    });
  }
  timeline.push(developerResult.prUrl ? `Developer opened PR ${developerResult.prUrl} for issue ${issue.issueId}.` : `Developer did not return a PR for issue ${issue.issueId}.`);

  if (!developerResult.prUrl) {
    const recovered = await maybeRebuildEnvironmentBlockedWorktree({
      project,
      workflow,
      issue,
      developerResult
    });
    if (recovered) {
      timeline.push(recovered);
      return {
        timeline,
        releaseNote: {
          issueId: issue.issueId,
          issueTitle: issue.title,
          developerRole: issue.developerRole ?? issue.assigneeRole,
          ownedPaths,
          developerSummary: developerResult.summary,
          blocked: false,
          reason: "Developer environment blocked; worktree rebuilt and developer retry queued"
        },
        blocked: false
      };
    }

    const blockedLabels = developerResult.blockedType === "spec"
      ? ["taskix:spec-blocked", "taskix:blocked"]
      : developerResult.blockedType === "environment"
        ? ["taskix:env-blocked", "taskix:blocked"]
        : ["taskix:blocked"];
    const blockedCleanupLabels = ["taskix:dev-running", "taskix:qa-failed", "qa-failed", "taskix:spec-blocked", "taskix:env-blocked"];
    issue.labels = [...new Set([...(issue.labels ?? []).filter((label) => !blockedCleanupLabels.includes(label.toLowerCase())), ...blockedLabels])];
    issue.prLabels = [...new Set([...(issue.prLabels ?? []).filter((label) => !blockedCleanupLabels.includes(label.toLowerCase())), ...blockedLabels])];
    if (developerResult.blockedType === "spec") {
      if (issue.githubIssueNumber) {
        await removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, blockedCleanupLabels);
        await addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, blockedLabels);
        await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, [
          "Developer blocked on issue specification.",
          "",
          "This issue needs architect clarification before development can continue.",
          "",
          "## Summary",
          developerResult.summary
        ].join("\n"));
      }
      timeline.push(`Developer marked ${issue.issueId} spec-blocked for architect clarification.`);
    } else {
      if (issue.githubIssueNumber) {
        await removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, blockedCleanupLabels);
        await addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, blockedLabels);
        await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, [
          "Developer blocked before PR creation.",
          "",
          `Blocked type: ${developerResult.blockedType || "unknown"}`,
          "",
          "## Summary",
          developerResult.summary
        ].join("\n"));
      }
      timeline.push(`Developer marked ${issue.issueId} blocked before PR creation: ${developerResult.blockedType}.`);
    }
    return {
      timeline,
      releaseNote: {
        issueId: issue.issueId,
        issueTitle: issue.title,
        developerRole: issue.developerRole ?? issue.assigneeRole,
        ownedPaths,
        developerSummary: developerResult.summary,
        blocked: true,
        reason: developerResult.blockedType === "spec"
          ? "Developer requested architect clarification"
          : developerResult.blockedType === "environment"
            ? "Developer environment blocked before PR creation"
            : "Developer did not return PR URL"
      },
      blocked: true
    };
  }

  const developerCompletionCleanupLabels = ["taskix:planned", "taskix:dev-running", "taskix:pr-opened", "qa-passed", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:spec-blocked", "taskix:env-blocked", "taskix:architect-review", "taskix:ready-to-merge", "taskix:blocked"];
  const developerCompletionLabels = ["taskix:need-qa", issue.developerRole ? `role:${issue.developerRole}` : "role:general_developer"];
  issue.labels = [...new Set([...(issue.labels ?? []).filter((label) => !developerCompletionCleanupLabels.includes(label.toLowerCase())), ...developerCompletionLabels])];
  issue.prLabels = [...new Set([...(issue.prLabels ?? []).filter((label) => !developerCompletionCleanupLabels.includes(label.toLowerCase())), ...developerCompletionLabels])];
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
  if (labels.some((label) => ["taskix:dev-running", "taskix:need-qa", "taskix:qa-running", "taskix:qa-passed", "taskix:ready-to-merge", "taskix:merged"].includes(label))) return false;
  const dependencies = issue.dependsOn ?? [];
  if (!dependencies.length) return true;
  return dependencies.every((dependency) => {
    const upstream = findDependencyIssue(dependency, issues);
    if (!upstream) return false;
    return isDependencySatisfied(upstream);
  });
}

function deriveQaSessionStatus(labels: string[]): "active" | "blocked" | "done" | null {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  if (normalizedLabels.includes("taskix:qa-passed")) return "done";
  if (normalizedLabels.includes("taskix:qa-failed") || normalizedLabels.includes("taskix:spec-blocked") || normalizedLabels.includes("taskix:env-blocked")) return "blocked";
  if (normalizedLabels.includes("taskix:need-qa") || normalizedLabels.includes("taskix:qa-running")) return "active";
  return null;
}

export { qaValidationInstruction };

export function plannerWorkflowInstruction(workflow: Pick<WorkflowRecord, "trackingCode" | "workflowId" | "userRequirement">): string {
  return `PM handed off requirement ${workflow.trackingCode ?? workflow.workflowId}:\n\n${workflow.userRequirement}`;
}

export function developerIssueInstruction(issue: Pick<IssueRecord, "githubIssueNumber" | "title">): string {
  return `Handle GitHub issue #${issue.githubIssueNumber}: ${issue.title}`;
}

function hasAgentMessage(session: Awaited<ReturnType<typeof getAgentSession>> | null, content: string): boolean {
  return Boolean(session?.messages.some((message) => message.content === content));
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

  const prUrl = await createPullRequestWithGh({
    repo,
    head: developerResult.branch,
    base: expectedDeveloperBaseBranch(),
    title: issue.title,
    body,
    labels: ["taskix:architect-review", issue.developerRole ? `role:${issue.developerRole}` : ""].filter(Boolean)
  });
  if (!isPullRequestUrl(prUrl)) throw new Error(`GitHub did not return a pull request URL for branch ${developerResult.branch}.`);
  return prUrl;
}

function isPullRequestUrl(value: string): boolean {
  return /\/pull\/\d+(?:\D|$)/.test(value);
}

async function maybeRebuildEnvironmentBlockedWorktree(input: {
  project: ProjectRecord;
  workflow: WorkflowRecord;
  issue: IssueRecord;
  developerResult: DeveloperIssueResult;
}): Promise<string | null> {
  if (input.developerResult.blockedType !== "environment") return null;
  if (!input.project.githubRepo || !input.issue.githubIssueNumber) return null;
  const settings = await getSettings();
  if (!settings.rebuildWorktreeOnEnvironmentBlocked) return null;

  const activeJobId = getActiveJobId();
  const activeJob = activeJobId ? await getJob(activeJobId) : null;
  if ((activeJob?.payload.worktreeRecoveryAttempt ?? 0) > 0) return null;

  const branch = input.developerResult.branch || expectedDeveloperBranch(displayWorkflowCode(input.workflow), input.issue.githubIssueNumber);
  const rebuilt = await rebuildDeveloperWorktree({
    repo: input.project.githubRepo,
    workflowCode: displayWorkflowCode(input.workflow),
    issueNumberOrId: input.issue.githubIssueNumber,
    branch,
    baseBranch: expectedDeveloperBaseBranch()
  });
  if (!rebuilt.rebuilt) return `Developer environment blocked for ${input.issue.issueId}; worktree rebuild failed: ${rebuilt.error ?? "unknown error"}.`;

  input.issue.branch = branch;
  input.issue.labels = [...new Set([...(input.issue.labels ?? []).filter((label) => label.toLowerCase() !== "taskix:blocked"), "taskix:dev-running"])];
  input.workflow.status = "in_progress";
  input.workflow.timeline.push(`Rebuilt developer worktree for ${input.issue.issueId}${rebuilt.archivedDir ? `; archived previous workspace at ${rebuilt.archivedDir}.` : "."}`);
  await saveWorkflow(input.workflow);
  await createJob({
    projectId: input.project.projectId,
    type: "issue_run",
    payload: {
      workflowId: input.workflow.workflowId,
      issueId: input.issue.issueId,
      branch,
      returnedFromQa: false,
      previousPrUrl: input.issue.prUrl ?? null,
      worktreeRecoveryAttempt: (activeJob?.payload.worktreeRecoveryAttempt ?? 0) + 1
    }
  });
  if (input.issue.githubIssueNumber) {
    try {
      await removeLabelsWithGh(input.project.githubRepo, input.issue.githubIssueNumber, ["taskix:blocked"]);
      await addLabelsWithGh(input.project.githubRepo, input.issue.githubIssueNumber, ["taskix:dev-running"]);
      await commentIssueWithGh(input.project.githubRepo, input.issue.githubIssueNumber, [
        "Taskix rebuilt the developer worktree after an environment blocker.",
        "",
        `Archived previous workspace: ${rebuilt.archivedDir ?? "none"}`,
        `Retry branch: ${branch}`
      ].join("\n"));
    } catch (error) {
      input.workflow.timeline.push(`Worktree rebuild for ${input.issue.issueId} succeeded, but GitHub label/comment update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return `Developer environment blocked for ${input.issue.issueId}; rebuilt worktree and queued developer retry.`;
}

async function publishDeveloperPrStateToGitHub(repo: string, issue: IssueRecord, prUrl: string): Promise<void> {
  const labelsToApply = ["taskix:need-qa", issue.developerRole ? `role:${issue.developerRole}` : ""].filter((label): label is string => Boolean(label));
  const labelsToClear = ["taskix:planned", "taskix:dev-running", "taskix:pr-opened", "qa-passed", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:spec-blocked", "taskix:env-blocked", "taskix:architect-review", "taskix:ready-to-merge", "taskix:blocked"];
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
    `QA ${qaResult.passed ? "passed" : qaResult.failureType === "spec" ? "blocked on specification" : qaResult.failureType === "environment" ? "blocked by environment" : "failed"} for ${issue.githubIssueNumber ? `issue #${issue.githubIssueNumber}` : issue.issueId}.`,
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
