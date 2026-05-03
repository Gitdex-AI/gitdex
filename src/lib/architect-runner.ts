import { CodexClient } from "@/lib/codex";
import { agentJobMessageId } from "@/lib/agent-run-messages";
import { commentIssueWithGh } from "@/lib/github-local";
import { getIssueStage, transitionIssueStage } from "@/lib/issue-stage";
import { getActiveJobId } from "@/lib/job-runtime";
import { syncWorkflowFromGitHub } from "@/lib/orchestrator";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, createJob, getAgentSession, getProject, getWorkflow, listJobs, saveWorkflow } from "@/lib/store";
import type { IssueRecord, ProjectRecord, ReviewerMergeResult, WorkflowRecord } from "@/lib/types";

export async function runWorkflowArchitectReview(workflowId: string, issueId: string, project?: ProjectRecord | null): Promise<void> {
  if (!project?.githubRepo) throw new Error("Project has no GitHub repo configured.");
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
  const issue = workflow.issues.find((item) => item.issueId === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found in workflow ${workflowId}`);
  if (!issue.githubIssueNumber || !issue.prUrl) throw new Error("Issue has no GitHub PR for review.");
  if (issue.prState === "MERGED") throw new Error("Merged PRs do not need review.");

  if (getIssueStage(issue) !== "gd:review") throw new Error("Reviewer requires QA to pass first.");

  const settings = await getSettings();
  const codex = new CodexClient(settings);
  const sessionKey = `${issue.issueId}:reviewer`;
  const existingReviewerSession = await getAgentSession(sessionKey);
  const reviewInstruction = architectReviewInstruction(issue);
  const reviewStartedAt = Date.now();
  const reviewStartedAtIso = new Date(reviewStartedAt).toISOString();
  if (!existingReviewerSession?.messages.some((message) => message.content === reviewInstruction)) {
    await appendAgentMessages({
      sessionKey,
      projectId: project.projectId,
      role: "reviewer",
      title: "Reviewer",
      sessionId: existingReviewerSession?.sessionId ?? null,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      prUrl: issue.prUrl,
      labels: issue.prLabels,
      status: "active",
      currentStep: "review requested",
      startedAt: reviewStartedAtIso,
      messages: [
        { role: "user", content: reviewInstruction, createdAt: reviewStartedAtIso }
      ]
    });
  }
  const review = await codex.architectConfirmManualReady({
    repo: project.githubRepo,
    issueNumber: issue.githubIssueNumber,
    prUrl: issue.prUrl
  });
  const reviewDurationMs = Math.max(0, Date.now() - reviewStartedAt);

  const now = new Date().toISOString();
  const passed = review.decision === "ready_to_merge";

  await transitionIssueStage({ repo: project.githubRepo, issue, stage: passed ? "gd:merge" : "gd:fix", prUrl: issue.prUrl });
  await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, `Reviewer code review ${passed ? "passed" : "blocked"}.\n\n${review.summary}`);

  workflow.status = passed ? "in_progress" : "blocked";
  workflow.timeline.push(passed ? `Reviewer code review passed for ${issue.issueId}. Ready for merge.` : `Reviewer code review blocked ${issue.issueId}: ${review.summary}`);
  await saveWorkflow(workflow);
  const activeJobId = getActiveJobId();

  await appendAgentMessages({
    sessionKey,
    projectId: project.projectId,
    role: "reviewer",
    title: "Reviewer",
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    githubIssueNumber: issue.githubIssueNumber,
    githubIssueUrl: issue.githubIssueUrl ?? null,
    prUrl: issue.prUrl,
    labels: issue.prLabels,
    currentStep: passed ? "review passed" : "review blocked",
    status: passed ? "done" : "blocked",
    executionLogs: [],
    messages: [
      {
        messageId: activeJobId ? agentJobMessageId(activeJobId) : undefined,
        jobId: activeJobId,
        role: "assistant",
        status: passed ? "done" : "blocked",
        durationMs: reviewDurationMs,
        executionLogs: review.executionLog ? [{
          title: `Reviewer code review for ${issue.title}`,
          content: review.executionLog,
          createdAt: now,
          status: passed ? "ok" : "failed",
          durationMs: reviewDurationMs
        }] : [],
        content: `Decision: ${review.decision}\n${review.summary}`,
        createdAt: now,
        updatedAt: now
      }
    ]
  });

  if (!passed) throw new Error(review.summary || "Reviewer blocked this PR.");
}

export async function runWorkflowMerge(workflowId: string, issueId: string, project?: ProjectRecord | null): Promise<void> {
  if (!project) throw new Error("Project not found.");
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
  const issue = workflow.issues.find((item) => item.issueId === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found in workflow ${workflowId}`);
  if (!issue.prUrl) throw new Error("Issue has no pull request to merge.");
  if (issue.prState === "MERGED") return;

  if (getIssueStage(issue) !== "gd:merge") {
    throw new Error("Reviewer code review must pass before merge.");
  }

  const result = await runArchitectMergeRequest(project, workflow, issue);
  if (result.decision === "needs_developer_rebase") {
    await returnMergeConflictToDeveloper(project, workflow, issue, result);
    return;
  }
  if (result.decision === "blocked") {
    workflow.status = "blocked";
    workflow.timeline.push(`Reviewer merge blocked ${issue.issueId}: ${result.blocker || result.summary}`);
    await saveWorkflow(workflow);
    throw new Error(result.blocker || result.summary || "Reviewer merge blocked.");
  }
  await syncWorkflowUntilMerged(project, workflow.workflowId, issue.issueId);
}

async function runArchitectMergeRequest(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord): Promise<ReviewerMergeResult> {
  const now = new Date().toISOString();
  const content = architectMergeInstruction(project, issue);
  const prUrl = issue.prUrl;
  if (!prUrl) throw new Error("Issue has no pull request to merge.");

  workflow.timeline.push(`Requested reviewer merge handling for ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const sessionKey = `${issue.issueId}:reviewer`;
  const [settings, existingReviewerSession] = await Promise.all([
    getSettings(),
    getAgentSession(sessionKey)
  ]);
  const codex = new CodexClient(settings);
  const mergeStartedAt = Date.now();
  if (!existingReviewerSession?.messages.some((message) => message.content === content)) {
    await appendAgentMessages({
      sessionKey,
      projectId: project.projectId,
      role: "reviewer",
      title: "Reviewer",
      sessionId: existingReviewerSession?.sessionId ?? null,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      prUrl: issue.prUrl ?? null,
      labels: issue.labels ?? [],
      status: "active",
      currentStep: "merge requested",
      startedAt: now,
      messages: [
        { role: "user", content, createdAt: now }
      ]
    });
  }
  const result = await codex.reviewerMergePr({
    projectName: project.name,
    repo: project.githubRepo,
    issueNumber: issue.githubIssueNumber ?? null,
    issueId: issue.issueId,
    prUrl
  });
  const mergeDurationMs = Math.max(0, Date.now() - mergeStartedAt);
  const activeJobId = getActiveJobId();
  const finishedAt = new Date().toISOString();

  await appendAgentMessages({
    sessionKey,
    projectId: project.projectId,
    role: "reviewer",
    title: "Reviewer",
    sessionId: existingReviewerSession?.sessionId ?? null,
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    prUrl: issue.prUrl ?? null,
    labels: issue.labels ?? [],
    currentStep: "merge requested",
    executionLogs: [],
    messages: [
      {
        messageId: activeJobId ? agentJobMessageId(activeJobId) : undefined,
        jobId: activeJobId,
        role: "assistant",
        status: "done",
        durationMs: mergeDurationMs,
        executionLogs: result.executionLog ? [{
          title: "Reviewer merge handling",
          content: result.executionLog,
          createdAt: finishedAt,
          status: "ok",
          durationMs: mergeDurationMs
        }] : [],
        content: `Decision: ${result.decision}\n${result.summary}${result.blocker && result.blocker !== "none" ? `\nBlocker: ${result.blocker}` : ""}`,
        createdAt: finishedAt,
        updatedAt: finishedAt
      }
    ]
  });
  return result;
}

async function returnMergeConflictToDeveloper(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord, result: ReviewerMergeResult): Promise<void> {
  if (!issue.prUrl) throw new Error("Issue has no pull request to return to developer.");
  const comment = [
    "This PR was returned to developer for rebase or branch update.",
    "",
    `Merge blocker: ${result.blocker || result.summary}`,
    "",
    "Developer action:",
    "- Rebase or merge latest main into the PR branch.",
    "- Resolve conflicts on the developer branch.",
    "- Push the same PR branch and request QA recheck because the branch changed after QA/review."
  ].join("\n");

  if (issue.githubIssueNumber) {
    await transitionIssueStage({ repo: project.githubRepo, issue, stage: "gd:rebase", prUrl: issue.prUrl });
    await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, comment);
  }
  workflow.status = "in_progress";
  workflow.timeline.push(`Returned ${issue.issueId} to developer for rebase after merge blocker: ${result.blocker || result.summary}`);

  const existingJob = (await listJobs(project.projectId)).find((job) => (
    job.type === "issue_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));
  if (!existingJob) {
    await createJob({
      projectId: project.projectId,
      type: "issue_run",
      payload: {
        workflowId: workflow.workflowId,
        issueId: issue.issueId,
        prUrl: issue.prUrl,
        branch: issue.branch ?? null,
        returnedFromQa: true,
        previousPrUrl: issue.prUrl
      }
    });
  }
  await saveWorkflow(workflow);
}

export function architectReviewInstruction(issue: Pick<IssueRecord, "githubIssueNumber" | "issueId" | "title" | "prUrl">): string {
  return [
    "Review this PR for merge readiness.",
    "",
    `Issue: ${issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : issue.issueId}`,
    `Title: ${issue.title}`,
    `PR: ${issue.prUrl ?? "none"}`
  ].join("\n");
}

export function architectMergeInstruction(project: ProjectRecord, issue: IssueRecord): string {
  return [
    "You are reviewer merge owner.",
    "",
    `GitHub repo: ${project.githubRepo}`,
    `Issue: ${issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : issue.issueId}`,
    `PR: ${issue.prUrl ?? "none"}`,
    "",
    "Read the issue, PR state, checks, labels, comments, and mergeability with gh. Treat the issue gd:merge label as the workflow source of truth.",
    "Only merge if gd:merge is present on the issue and no blocker exists.",
    "If merged, close the issue. Taskix will apply gd:done.",
    "If merge is blocked by conflicts, non-fast-forward state, branch out of date, or any rebase-required condition, do not edit code or resolve conflicts as reviewer. Report that the PR must return to developer for rebase/branch update, and include the exact blocker from GitHub.",
    "If blocked by checks or policy, report the blocker so Taskix can route it to the correct next role."
  ].join("\n");
}

async function syncWorkflowUntilMerged(project: ProjectRecord, workflowId: string, issueId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt) await sleep(1000);
    const workflow = await syncWorkflowFromGitHub(workflowId, project);
    const issue = workflow.issues.find((item) => item.issueId === issueId);
    if (issue?.githubState === "CLOSED" || issue?.prState === "MERGED") return;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
