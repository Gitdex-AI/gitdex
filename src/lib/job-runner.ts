import { runWorkflowArchitectReview, runWorkflowMerge } from "@/lib/architect-runner";
import { runArchitectBlockerResolution } from "@/lib/architect-blocker-runner";
import { appendAgentRunPlaceholder } from "@/lib/agent-run-messages";
import { runWorkflow, runWorkflowIssue, runWorkflowQa, syncWorkflowFromGitHub } from "@/lib/orchestrator";
import { runWithJobRuntime } from "@/lib/job-runtime";
import { claimNextPendingJob, claimPendingJob, getAgentSession, getJob, getProject, getWorkflow, saveJob } from "@/lib/store";
import type { IssueRecord, JobRecord, ProjectRecord, WorkflowRecord } from "@/lib/types";
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
      if (project && workflow) await ensureRunningPlaceholder(project, workflow, job);
      if (job.type === "architect_blocker_run" && project && job.payload.sessionKey) {
        await runArchitectBlockerResolution(project, job.payload.sessionKey);
      } else if (job.type === "issue_run" && job.payload.issueId) {
        await runWorkflowIssue(job.payload.workflowId, job.payload.issueId, project);
      } else if (job.type === "qa_run" && job.payload.issueId) {
        await runWorkflowQa(job.payload.workflowId, job.payload.issueId, project, {
          prUrl: job.payload.prUrl ?? null,
          headSha: job.payload.headSha ?? null,
          qaAttempt: job.payload.qaAttempt ?? null
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
    await appendAgentRunPlaceholder({
      project,
      workflow,
      issue,
      job,
      sessionKey: issue.developerSessionId ?? `${issue.issueId}:developer`,
      role: "developer",
      title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
      label: issue.developerRole ?? "Dev",
      developerRole: issue.developerRole ?? "general_developer",
      currentStep: "developer handling GitHub issue",
      labels: ["taskix:dev-running"]
    });
    return;
  }
  if (job.type === "qa_run" && issue) {
    await appendAgentRunPlaceholder({
      project,
      workflow,
      issue,
      job,
      sessionKey: issue.qaSessionId ?? `${issue.issueId}:qa`,
      role: "qa",
      title: `QA: ${issue.title}`,
      label: "QA",
      currentStep: "QA validating PR",
      prUrl: job.payload.prUrl ?? issue.prUrl ?? null,
      labels: ["taskix:need-qa", "taskix:qa-running"]
    });
    return;
  }
  if ((job.type === "architect_review_run" || job.type === "merge_run") && issue) {
    const sessionKey = `${issue.issueId}:reviewer`;
    const existing = await getAgentSession(sessionKey);
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

async function cleanupCompletedWorktreesIfEnabled(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.autoCleanupCompletedWorktrees) return;
    await cleanupInactiveWorktrees(settings.worktreeRetentionDays);
  } catch {
    // Cleanup is opportunistic and should not affect workflow job outcomes.
  }
}
