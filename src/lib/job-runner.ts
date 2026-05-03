import { architectMergeInstruction, architectReviewInstruction, runWorkflowArchitectReview, runWorkflowMerge } from "@/lib/architect-runner";
import { architectBlockerInstruction, runArchitectBlockerResolution } from "@/lib/architect-blocker-runner";
import { appendAgentRunPlaceholder } from "@/lib/agent-run-messages";
import { developerIssueInstruction, plannerWorkflowInstruction, qaValidationInstruction, runWorkflow, runWorkflowIssue, runWorkflowQa, syncWorkflowFromGitHub } from "@/lib/orchestrator";
import { runWithJobRuntime } from "@/lib/job-runtime";
import { appendAgentMessages, claimNextPendingJob, claimPendingJob, getAgentSession, getJob, getProject, getWorkflow, saveJob } from "@/lib/store";
import type { AgentSessionRecord, IssueRecord, JobRecord, ProjectRecord, WorkflowRecord } from "@/lib/types";
import { getSettings } from "@/lib/settings";
import { cleanupInactiveWorktrees } from "@/lib/worktree-manager";

export async function runNextJob(projectId?: string): Promise<{ job: JobRecord | null; ran: boolean }> {
  const job = await claimNextPendingJob(projectId);
  if (!job) return { job: null, ran: false };
  return runClaimedJob(job);
}

export async function runJobById(jobId: string, projectId?: string): Promise<{ job: JobRecord | null; ran: boolean }> {
  const job = await claimPendingJob(jobId, projectId);
  if (!job) return { job: await getJob(jobId), ran: false };
  return runClaimedJob(job);
}

export async function runJobsById(jobIds: string[], projectId?: string): Promise<{ results: { job: JobRecord | null; ran: boolean }[] }> {
  const claimedJobs = [];
  for (const jobId of jobIds) {
    const job = await claimPendingJob(jobId, projectId);
    claimedJobs.push(job);
  }

  const results = await Promise.all(claimedJobs.map(async (job, index) => {
    if (!job) return { job: await getJob(jobIds[index]), ran: false };
    return runClaimedJob(job);
  }));
  return { results };
}

async function runClaimedJob(job: JobRecord): Promise<{ job: JobRecord | null; ran: boolean }> {
  let skipped = false;

  try {
    await runWithJobRuntime(job.jobId, async () => {
      if (!["workflow_run", "issue_run", "qa_run", "architect_blocker_run", "architect_review_run", "merge_run"].includes(job.type)) return;
      const project = job.projectId ? await getProject(job.projectId) : null;
      const workflow = await getWorkflow(job.payload.workflowId);
      if (workflow?.paused) {
        job.status = "pending";
        job.error = "Workflow is paused";
        job.updatedAt = new Date().toISOString();
        await saveJob(job);
        skipped = true;
        return;
      }
      if (project && workflow) {
        await ensureRunningPlaceholder(project, workflow, job);
        await sleep(1000);
      }
      if (job.type === "architect_blocker_run" && project && job.payload.sessionKey) {
        await runArchitectBlockerResolution(project, job.payload.sessionKey);
      } else if (job.type === "issue_run" && job.payload.issueId) {
        await runWorkflowIssue(job.payload.workflowId, job.payload.issueId, project);
      } else if (job.type === "qa_run" && job.payload.issueId) {
        await runWorkflowQa(job.payload.workflowId, job.payload.issueId, project, {
          prUrl: job.payload.prUrl ?? null,
          headSha: job.payload.headSha ?? null,
          qaAttempt: job.payload.qaAttempt ?? null,
          previewUrl: job.payload.previewUrl ?? null
        });
      } else if (job.type === "architect_review_run" && job.payload.issueId) {
        await runWorkflowArchitectReview(job.payload.workflowId, job.payload.issueId, project);
      } else if (job.type === "merge_run" && job.payload.issueId) {
        await runWorkflowMerge(job.payload.workflowId, job.payload.issueId, project);
      } else {
        await runWorkflow(job.payload.workflowId, project);
      }
      await syncWorkflowFromGitHub(job.payload.workflowId, project);
    });
    if (!skipped) {
      job.status = "done";
      job.error = null;
    }
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Unknown job failure";
  }

  const latestJob = await getJob(job.jobId);
  job.updatedAt = new Date().toISOString();
  job.runtime = { ...(job.runtime ?? {}), ...(latestJob?.runtime ?? {}), finishedAt: skipped ? latestJob?.runtime?.finishedAt ?? job.runtime?.finishedAt ?? null : job.updatedAt };
  await saveJob(job);
  await cleanupCompletedWorktreesIfEnabled();
  return { job, ran: !skipped };
}

async function ensureRunningPlaceholder(project: ProjectRecord, workflow: WorkflowRecord, job: JobRecord): Promise<void> {
  const issue = job.payload.issueId ? workflow.issues.find((item) => item.issueId === job.payload.issueId) ?? null : null;
  if (job.type === "workflow_run") {
    const sessionKey = `${workflow.workflowId}:planner`;
    const existing = await getAgentSession(sessionKey);
    await appendRunUserInstruction({
      project,
      workflow,
      sessionKey,
      role: "planner",
      title: "Planner",
      content: plannerWorkflowInstruction(workflow),
      sessionId: existing?.sessionId ?? null,
      currentStep: "planning GitHub issues",
      labels: []
    });
    await appendAgentRunPlaceholder({
      project,
      workflow,
      job,
      sessionKey,
      role: "planner",
      title: "Planner",
      label: "Planner",
      sessionId: existing?.sessionId ?? null,
      currentStep: "planning GitHub issues",
      labels: []
    });
    return;
  }
  if (job.type === "issue_run" && issue) {
    const sessionKey = issue.developerSessionId ?? `${issue.issueId}:developer`;
    const instruction = developerIssueInstruction(issue);
    await appendRunUserInstruction({
      project,
      workflow,
      issue,
      sessionKey,
      role: "developer",
      title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
      content: instruction,
      developerRole: issue.developerRole ?? "general_developer",
      ownedPaths: issue.ownedPaths ?? [],
      currentStep: "developer handling GitHub issue",
      labels: ["gd:dev"]
    });
    await appendAgentRunPlaceholder({
      project,
      workflow,
      issue,
      job,
      sessionKey,
      role: "developer",
      title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
      label: issue.developerRole ?? "Dev",
      developerRole: issue.developerRole ?? "general_developer",
      currentStep: "developer handling GitHub issue",
      labels: ["gd:dev"]
    });
    return;
  }
  if (job.type === "qa_run" && issue) {
    const sessionKey = issue.qaSessionId ?? `${issue.issueId}:qa`;
    const prUrl = job.payload.prUrl ?? issue.prUrl ?? "";
    const instruction = qaValidationInstruction(prUrl, issue, job.payload.headSha ?? null, job.payload.previewUrl ?? undefined);
    await appendRunUserInstruction({
      project,
      workflow,
      issue,
      sessionKey,
      role: "qa",
      title: `QA: ${issue.title}`,
      content: instruction,
      currentStep: "QA validating PR",
      prUrl,
      labels: ["gd:qa"]
    });
    await appendAgentRunPlaceholder({
      project,
      workflow,
      issue,
      job,
      sessionKey,
      role: "qa",
      title: `QA: ${issue.title}`,
      label: "QA",
      currentStep: "QA validating PR",
      prUrl: job.payload.prUrl ?? issue.prUrl ?? null,
      labels: ["gd:qa"]
    });
    return;
  }
  if ((job.type === "architect_review_run" || job.type === "merge_run") && issue) {
    const sessionKey = `${issue.issueId}:reviewer`;
    const existing = await getAgentSession(sessionKey);
    const instruction = job.type === "merge_run" ? architectMergeInstruction(project, issue) : architectReviewInstruction(issue);
    await appendRunUserInstruction({
      project,
      workflow,
      issue,
      sessionKey,
      role: "reviewer",
      title: "Reviewer",
      content: instruction,
      sessionId: existing?.sessionId ?? null,
      currentStep: job.type === "merge_run" ? "merge requested" : "review requested",
      prUrl: job.payload.prUrl ?? issue.prUrl ?? null,
      labels: issue.labels ?? []
    });
    await appendAgentRunPlaceholder({
      project,
      workflow,
      issue,
      job,
      sessionKey,
      role: "reviewer",
      title: "Reviewer",
      label: "Reviewer",
      sessionId: existing?.sessionId ?? null,
      currentStep: job.type === "merge_run" ? "merge requested" : "review requested",
      prUrl: job.payload.prUrl ?? issue.prUrl ?? null,
      labels: issue.labels ?? []
    });
    return;
  }
  if (job.type === "architect_blocker_run" && job.payload.sessionKey) {
    const blockedSession = await getAgentSession(job.payload.sessionKey);
    const sessionKey = `${blockedSession?.issueId ?? job.payload.issueId ?? job.payload.sessionKey}:architect`;
    const existing = await getAgentSession(sessionKey);
    if (blockedSession) {
      await appendRunUserInstruction({
        project,
        workflow,
        issue: issue ?? {
          issueId: blockedSession.issueId ?? job.payload.issueId ?? job.payload.sessionKey,
          githubIssueNumber: blockedSession.githubIssueNumber ?? null,
          githubIssueUrl: blockedSession.githubIssueUrl ?? null,
          prUrl: blockedSession.prUrl ?? null,
          ownedPaths: blockedSession.ownedPaths ?? []
        },
        sessionKey,
        role: "architect",
        title: "Architect",
        content: architectBlockerInstruction(blockedSession),
        sessionId: existing?.sessionId ?? null,
        currentStep: "resolving blocker",
        githubIssueNumber: blockedSession.githubIssueNumber ?? null,
        githubIssueUrl: blockedSession.githubIssueUrl ?? null,
        prUrl: blockedSession.prUrl ?? null,
        labels: blockedSession.labels ?? []
      });
    }
    await appendAgentRunPlaceholder({
      project,
      workflow,
      issue: issue ?? (blockedSession?.issueId ? {
        issueId: blockedSession.issueId,
        githubIssueNumber: blockedSession.githubIssueNumber ?? null,
        githubIssueUrl: blockedSession.githubIssueUrl ?? null,
        prUrl: blockedSession.prUrl ?? null,
        ownedPaths: blockedSession.ownedPaths ?? []
      } satisfies Pick<IssueRecord, "issueId" | "githubIssueNumber" | "githubIssueUrl" | "prUrl" | "ownedPaths"> : null),
      job,
      sessionKey,
      role: "architect",
      title: "Architect",
      label: "Architect",
      sessionId: existing?.sessionId ?? null,
      currentStep: "resolving blocker",
      githubIssueNumber: blockedSession?.githubIssueNumber ?? null,
      githubIssueUrl: blockedSession?.githubIssueUrl ?? null,
      prUrl: blockedSession?.prUrl ?? null,
      labels: blockedSession?.labels ?? []
    });
  }
}

async function appendRunUserInstruction(input: {
  project: ProjectRecord;
  workflow: WorkflowRecord;
  issue?: Pick<IssueRecord, "issueId" | "githubIssueNumber" | "githubIssueUrl" | "prUrl" | "ownedPaths"> | null;
  sessionKey: string;
  role: AgentSessionRecord["role"];
  title: string;
  content: string;
  sessionId?: string | null;
  developerRole?: AgentSessionRecord["developerRole"];
  ownedPaths?: string[];
  currentStep: string;
  githubIssueNumber?: number | null;
  githubIssueUrl?: string | null;
  prUrl?: string | null;
  labels?: string[];
}): Promise<void> {
  const existing = await getAgentSession(input.sessionKey);
  await appendAgentMessages({
    sessionKey: input.sessionKey,
    projectId: input.project.projectId,
    role: input.role,
    title: input.title,
    sessionId: input.sessionId ?? existing?.sessionId ?? null,
    workflowId: input.workflow.workflowId,
    issueId: input.issue?.issueId ?? null,
    developerRole: input.developerRole,
    ownedPaths: input.ownedPaths ?? input.issue?.ownedPaths ?? [],
    status: "active",
    currentStep: input.currentStep,
    startedAt: new Date().toISOString(),
    githubIssueNumber: input.githubIssueNumber ?? input.issue?.githubIssueNumber ?? null,
    githubIssueUrl: input.githubIssueUrl ?? input.issue?.githubIssueUrl ?? null,
    prUrl: input.prUrl ?? input.issue?.prUrl ?? null,
    labels: input.labels,
    messages: [
      { role: "user", content: input.content, createdAt: new Date().toISOString() }
    ]
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupCompletedWorktreesIfEnabled(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.autoCleanupCompletedWorktrees) return;
    await cleanupInactiveWorktrees(settings.worktreeRetentionDays);
  } catch {
    // Cleanup is opportunistic and should not affect workflow job outcomes.
  }
}
