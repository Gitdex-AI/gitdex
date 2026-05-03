import { runJobById } from "@/lib/job-runner";
import { shouldCancelAutoRun, shouldPauseAutoRun, startAutoRunState, updateAutoRunState } from "@/lib/auto-run-control";
import { canAutoRunDeveloper, canAutoRunQa, isClosedIssue } from "@/lib/auto-run-policy";
import { commentIssueWithGh, getPullRequestHeadShaWithGh } from "@/lib/github-local";
import { getIssueStage, transitionIssueStage } from "@/lib/issue-stage";
import { findDependencyIssue, isDependencySatisfied } from "@/lib/issue-dependencies";
import { syncWorkflowFromGitHub } from "@/lib/orchestrator";
import { allocateQaPreviewPort, qaPreviewUrl } from "@/lib/qa-preview-port";
import { cancelPendingJobs, createJob, listAgentSessions, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
import type { AgentSessionRecord, IssueRecord, JobRecord, JobType, ProjectRecord, WorkflowRecord } from "@/lib/types";

const autoRunnableJobTypes: JobType[] = ["architect_blocker_run", "issue_run", "qa_run", "architect_review_run", "merge_run"];
type AutoRunStep = {
  action: string;
  jobIds: string[];
};

type ActiveJobRuns = Map<string, Promise<void>>;

export async function runProjectIssueAutoRun(project: ProjectRecord, options: { workflowIds?: string[]; issueIds?: string[] } = {}): Promise<{ completed: boolean; steps: AutoRunStep[]; message: string }> {
  if (!project.githubRepo) throw new Error("Project has no GitHub repo configured.");
  const workflowScope = new Set(options.workflowIds ?? []);
  const issueScope = new Set(options.issueIds ?? []);
  const runState = startAutoRunState(project.projectId, { workflowIds: [...workflowScope], issueIds: [...issueScope] });
  const steps: AutoRunStep[] = [];
  const activeRuns: ActiveJobRuns = new Map();

  try {
    for (let cycle = 0; cycle < 120; cycle += 1) {
      const controlResult = handleAutoRunControl(project.projectId, runState.runId, steps);
      if (controlResult) return controlResult;

      await syncProjectWorkflows(project, workflowScope);
      const workflows = filterWorkflows(await listProjectWorkflows(project.projectId), workflowScope);
      const jobs = filterJobsForIssueScope(await listJobs(project.projectId), workflows, issueScope);

      const sessions = await listAgentSessions(project.projectId);
      const environmentBlocker = findEnvironmentBlockedIssue(workflows, issueScope);
      if (environmentBlocker) {
        const message = `Auto Run paused because ${environmentBlocker.githubIssueNumber ? `issue #${environmentBlocker.githubIssueNumber}` : environmentBlocker.issueId} is blocked by the local execution environment. Fix the environment or provide a usable preview before resuming.`;
        updateAutoRunState(project.projectId, { runId: runState.runId, status: "paused", message });
        return { completed: false, steps, message };
      }
      const batch = await findOrCreateNextBatch(project, workflows, sessions, jobs, issueScope);
      if (!batch.jobIds.length) {
        if (activeRuns.size) {
          await waitForNextActiveJob(activeRuns);
          continue;
        }
        if (jobs.some((job) => job.status === "running" && autoRunnableJobTypes.includes(job.type))) {
          const message = "Auto Run paused because existing issue jobs are still running.";
          updateAutoRunState(project.projectId, { runId: runState.runId, status: "paused", message });
          return { completed: false, steps, message };
        }
        const message = "No runnable issue jobs remain.";
        updateAutoRunState(project.projectId, { runId: runState.runId, status: "completed", message });
        return { completed: true, steps, message };
      }

      steps.push(batch);
      startActiveJobs(project.projectId, batch.jobIds, activeRuns);
      await waitForNextActiveJob(activeRuns);
      const postRunControlResult = handleAutoRunControl(project.projectId, runState.runId, steps);
      if (postRunControlResult) return postRunControlResult;
    }

    const message = "Auto Run stopped after reaching the safety cycle limit.";
    updateAutoRunState(project.projectId, { runId: runState.runId, status: "failed", message });
    return { completed: false, steps, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto Run failed.";
    updateAutoRunState(project.projectId, { runId: runState.runId, status: "failed", message });
    throw error;
  }
}

function startActiveJobs(projectId: string, jobIds: string[], activeRuns: ActiveJobRuns): void {
  for (const jobId of jobIds) {
    if (activeRuns.has(jobId)) continue;
    const run = runJobById(jobId, projectId)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        activeRuns.delete(jobId);
      });
    activeRuns.set(jobId, run);
  }
}

async function waitForNextActiveJob(activeRuns: ActiveJobRuns): Promise<void> {
  if (!activeRuns.size) return;
  await Promise.race(activeRuns.values());
}

function handleAutoRunControl(projectId: string, runId: string, steps: AutoRunStep[]): { completed: boolean; steps: AutoRunStep[]; message: string } | null {
  if (shouldCancelAutoRun(projectId, runId)) {
    const message = "Auto Run cancelled.";
    updateAutoRunState(projectId, { runId, status: "cancelled", message });
    return { completed: false, steps, message };
  }
  if (shouldPauseAutoRun(projectId, runId)) {
    const message = "Auto Run paused.";
    updateAutoRunState(projectId, { runId, status: "paused", message });
    return { completed: false, steps, message };
  }
  return null;
}

async function syncProjectWorkflows(project: ProjectRecord, workflowScope = new Set<string>()): Promise<void> {
  const workflows = filterWorkflows(await listProjectWorkflows(project.projectId), workflowScope);
  for (const workflow of workflows) {
    await syncWorkflowFromGitHub(workflow.workflowId, project);
  }
}

function filterWorkflows(workflows: WorkflowRecord[], workflowScope: Set<string>): WorkflowRecord[] {
  return workflowScope.size ? workflows.filter((workflow) => workflowScope.has(workflow.workflowId)) : workflows;
}

function filterWorkflowsForIssueScope(workflows: WorkflowRecord[], issueScope: Set<string>): WorkflowRecord[] {
  if (!issueScope.size) return workflows;
  return workflows
    .map((workflow) => ({
      ...workflow,
      issues: workflow.issues.filter((issue) => issueScope.has(issue.issueId))
    }))
    .filter((workflow) => workflow.issues.length);
}

function filterJobsForIssueScope(jobs: JobRecord[], workflows: WorkflowRecord[], issueScope: Set<string>): JobRecord[] {
  if (!issueScope.size) return jobs;
  const visibleIssueIds = new Set(workflows.flatMap((workflow) => workflow.issues.map((issue) => issue.issueId)).filter((issueId) => issueScope.has(issueId)));
  return jobs.filter((job) => job.payload.issueId ? visibleIssueIds.has(job.payload.issueId) : false);
}

async function findOrCreateNextBatch(
  project: ProjectRecord,
  workflows: WorkflowRecord[],
  sessions: AgentSessionRecord[],
  jobs: JobRecord[],
  issueScope: Set<string>
): Promise<AutoRunStep> {
  const pending = selectRunnableJobs(workflows, jobs.filter((job) => job.status === "pending" && autoRunnableJobTypes.includes(job.type)));
  if (pending.jobIds.length) return pending;

  const scopedWorkflows = filterWorkflowsForIssueScope(workflows, issueScope);
  const issueRows = scopedWorkflows
    .flatMap((workflow) => workflow.issues.map((issue) => ({ workflow, issue })))
    .filter(({ issue }) => !issueScope.size || issueScope.has(issue.issueId));
  const failedReturnRows = issueRows.filter(({ workflow, issue }) => shouldReturnFailedJobToDeveloper(issue, workflow, jobs));
  const returnRows = failedReturnRows.length ? failedReturnRows : issueRows.filter(({ issue }) => shouldReturnQaFailureToDeveloper(issue) || shouldReturnRebaseToDeveloper(issue));
  const jobsToRun: JobRecord[] = [];
  jobsToRun.push(...await Promise.all(returnRows.map(({ workflow, issue }) => ensureReturnDeveloperJob(project, workflow, issue))));

  const returnedIssueIds = new Set(returnRows.map(({ issue }) => issue.issueId));
  for (const { workflow, issue } of issueRows) {
    if (returnedIssueIds.has(issue.issueId)) continue;
    const stage = getIssueStage(issue);
    if (stage === "gd:architect") {
      const job = await ensureArchitectBlockerJob(project, workflow, issue, sessions);
      if (job) jobsToRun.push(job);
    } else if (stage === "gd:dev" && canRunDeveloperIssue(issue, workflow.issues)) {
      jobsToRun.push(await ensureDeveloperJob(project, workflow, issue));
    } else if (stage === "gd:qa" && canRunQa(issue)) {
      jobsToRun.push(await ensureQaJob(project, workflow, issue));
    } else if (stage === "gd:review" && canRunArchitectReview(issue)) {
      jobsToRun.push(await ensureArchitectReviewJob(project, workflow, issue));
    } else if (stage === "gd:merge" && canRunMerge(issue)) {
      jobsToRun.push(await ensureMergeJob(project, workflow, issue));
    }
  }

  const uniqueJobs = uniqueJobsById(jobsToRun);
  if (uniqueJobs.length) return { action: "auto", jobIds: uniqueJobs.map((job) => job.jobId) };

  return { action: "idle", jobIds: [] };
}

function selectRunnableJobs(workflows: WorkflowRecord[], jobs: JobRecord[]): AutoRunStep {
  const rows = jobs
    .map((job) => ({ job, issue: findIssueForJob(workflows, job) }))
    .filter((row): row is { job: JobRecord; issue: IssueRecord } => {
      if (!row.issue) return false;
      return !isClosedIssue(row.issue);
    });
  if (!rows.length) return { action: "idle", jobIds: [] };
  return { action: "pending", jobIds: rows.map((row) => row.job.jobId) };
}

function findIssueForJob(workflows: WorkflowRecord[], job: JobRecord): IssueRecord | null {
  if (!job.payload.issueId) return null;
  return workflows.flatMap((workflow) => workflow.issues).find((issue) => issue.issueId === job.payload.issueId) ?? null;
}

function canRunDeveloperIssue(issue: IssueRecord, issues: IssueRecord[]): boolean {
  if (!canAutoRunDeveloper(issue)) return false;
  const dependencies = issue.dependsOn ?? [];
  if (!dependencies.length) return true;
  return dependencies.every((dependency) => {
    const upstream = findDependencyIssue(dependency, issues);
    return upstream ? isDependencySatisfied(upstream) : false;
  });
}

function findEnvironmentBlockedIssue(workflows: WorkflowRecord[], issueScope: Set<string>): IssueRecord | null {
  return workflows
    .flatMap((workflow) => workflow.issues)
    .find((issue) => (!issueScope.size || issueScope.has(issue.issueId)) && getIssueStage(issue) === "gd:blocked") ?? null;
}

function canRunQa(issue: IssueRecord): boolean {
  return canAutoRunQa(issue);
}

function canRunArchitectReview(issue: IssueRecord): boolean {
  return Boolean(issue.prUrl)
    && !isClosedIssue(issue)
    && issue.prState !== "MERGED"
    && getIssueStage(issue) === "gd:review";
}

function canRunMerge(issue: IssueRecord): boolean {
  return Boolean(issue.prUrl) && !isClosedIssue(issue) && issue.prState !== "MERGED" && getIssueStage(issue) === "gd:merge";
}

function shouldReturnQaFailureToDeveloper(issue: IssueRecord): boolean {
  return Boolean(issue.prUrl)
    && !isClosedIssue(issue)
    && issue.prState !== "MERGED"
    && getIssueStage(issue) === "gd:fix";
}

function shouldReturnRebaseToDeveloper(issue: IssueRecord): boolean {
  return Boolean(issue.prUrl)
    && !isClosedIssue(issue)
    && issue.prState !== "MERGED"
    && getIssueStage(issue) === "gd:rebase";
}

function shouldReturnFailedJobToDeveloper(issue: IssueRecord, workflow: WorkflowRecord, jobs: JobRecord[]): boolean {
  const latest = jobs
    .filter((job) => job.payload.workflowId === workflow.workflowId && job.payload.issueId === issue.issueId && (job.type === "architect_review_run" || job.type === "merge_run"))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  return Boolean(issue.prUrl) && !isClosedIssue(issue) && issue.prState !== "MERGED" && latest?.status === "failed";
}

async function ensureDeveloperJob(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord): Promise<JobRecord> {
  const existing = await findRunnableJob(project.projectId, workflow.workflowId, issue.issueId, "issue_run");
  return existing ?? createJob({
    projectId: project.projectId,
    type: "issue_run",
    payload: { workflowId: workflow.workflowId, issueId: issue.issueId, prUrl: issue.prUrl ?? null, branch: issue.branch ?? null, returnedFromQa: false, previousPrUrl: issue.prUrl ?? null }
  });
}

async function ensureQaJob(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord): Promise<JobRecord> {
  if (!issue.prUrl) throw new Error(`Issue ${issue.issueId} has no pull request for QA.`);
  const existing = await findRunnableJob(project.projectId, workflow.workflowId, issue.issueId, "qa_run");
  if (existing) return existing;
  const headSha = await getPullRequestHeadShaWithGh(project.githubRepo, issue.prUrl);
  const jobs = await listJobs(project.projectId);
  const previewPort = allocateQaPreviewPort(jobs);
  const previewUrl = qaPreviewUrl(previewPort);
  const qaAttempt = jobs
    .filter((job) => job.type === "qa_run" && job.payload.workflowId === workflow.workflowId && job.payload.issueId === issue.issueId)
    .map((job) => job.payload.qaAttempt ?? 0)
    .reduce((max, value) => Math.max(max, value), 0) + 1;
  await transitionIssueStage({ repo: project.githubRepo, issue, stage: "gd:qa", prUrl: issue.prUrl });
  workflow.status = "in_progress";
  workflow.timeline.push(`Auto Run handed ${issue.issueId} to QA.`);
  await saveWorkflow(workflow);
  await cancelPendingJobs({ projectId: project.projectId, workflowId: workflow.workflowId, issueId: issue.issueId, type: "qa_run", reason: `Superseded by Auto Run QA handoff attempt ${qaAttempt}.` });
  return createJob({
    projectId: project.projectId,
    type: "qa_run",
    payload: { workflowId: workflow.workflowId, issueId: issue.issueId, prUrl: issue.prUrl, branch: issue.branch ?? null, headSha, qaAttempt, previewPort, previewUrl }
  });
}

async function ensureReturnDeveloperJob(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord): Promise<JobRecord> {
  if (!issue.prUrl) throw new Error(`Issue ${issue.issueId} has no pull request to return to developer.`);
  const existing = await findRunnableJob(project.projectId, workflow.workflowId, issue.issueId, "issue_run");
  if (existing) return existing;
  await transitionIssueStage({ repo: project.githubRepo, issue, stage: getIssueStage(issue) === "gd:rebase" ? "gd:rebase" : "gd:fix", prUrl: issue.prUrl });
  if (issue.githubIssueNumber) {
    await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, [
      "This PR was returned to developer by Auto Run.",
      "",
      "Reason: QA, reviewer, or merge handling found this PR needs developer rework before it can continue."
    ].join("\n"));
  }
  workflow.status = "in_progress";
  workflow.timeline.push(`Auto Run returned ${issue.issueId} to developer.`);
  await saveWorkflow(workflow);
  await cancelPendingJobs({ projectId: project.projectId, workflowId: workflow.workflowId, issueId: issue.issueId, type: "qa_run", reason: `Superseded because Auto Run returned ${issue.issueId} to developer.` });
  return createJob({
    projectId: project.projectId,
    type: "issue_run",
    payload: { workflowId: workflow.workflowId, issueId: issue.issueId, prUrl: issue.prUrl, branch: issue.branch ?? null, returnedFromQa: true, previousPrUrl: issue.prUrl }
  });
}

async function ensureArchitectBlockerJob(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord, sessions: AgentSessionRecord[]): Promise<JobRecord | null> {
  const session = sessions.find((candidate) => candidate.issueId === issue.issueId && candidate.status === "blocked") ?? null;
  if (!session) return null;
  const existing = await findRunnableJob(project.projectId, workflow.workflowId, issue.issueId, "architect_blocker_run");
  return existing ?? createJob({
    projectId: project.projectId,
    type: "architect_blocker_run",
    payload: { workflowId: workflow.workflowId, issueId: issue.issueId, sessionKey: session.sessionKey }
  });
}

async function ensureArchitectReviewJob(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord): Promise<JobRecord> {
  const existing = await findRunnableJob(project.projectId, workflow.workflowId, issue.issueId, "architect_review_run");
  return existing ?? createJob({
    projectId: project.projectId,
    type: "architect_review_run",
    payload: { workflowId: workflow.workflowId, issueId: issue.issueId, prUrl: issue.prUrl ?? null }
  });
}

async function ensureMergeJob(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord): Promise<JobRecord> {
  const existing = await findRunnableJob(project.projectId, workflow.workflowId, issue.issueId, "merge_run");
  return existing ?? createJob({
    projectId: project.projectId,
    type: "merge_run",
    payload: { workflowId: workflow.workflowId, issueId: issue.issueId, prUrl: issue.prUrl ?? null }
  });
}

async function findRunnableJob(projectId: string, workflowId: string, issueId: string, type: JobType): Promise<JobRecord | null> {
  return (await listJobs(projectId)).find((job) => (
    job.type === type
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflowId
    && job.payload.issueId === issueId
  )) ?? null;
}

function uniqueJobsById(jobs: JobRecord[]): JobRecord[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    if (seen.has(job.jobId)) return false;
    seen.add(job.jobId);
    return true;
  });
}
