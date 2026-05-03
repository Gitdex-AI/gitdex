import { CodexClient } from "@/lib/codex";
import { agentJobMessageId } from "@/lib/agent-run-messages";
import { addLabelsWithGh, commentIssueWithGh, removeLabelsWithGh } from "@/lib/github-local";
import { getActiveJobId } from "@/lib/job-runtime";
import { syncWorkflowFromGitHub } from "@/lib/orchestrator";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, getAgentSession, getProject, getWorkflow, saveWorkflow } from "@/lib/store";
import type { IssueRecord, ProjectRecord, WorkflowRecord } from "@/lib/types";

const removeReviewLabels = ["taskix:architect-review", "taskix:ready-to-merge", "taskix:blocked"];

export async function runWorkflowArchitectReview(workflowId: string, issueId: string, project?: ProjectRecord | null): Promise<void> {
  if (!project?.githubRepo) throw new Error("Project has no GitHub repo configured.");
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
  const issue = workflow.issues.find((item) => item.issueId === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found in workflow ${workflowId}`);
  if (!issue.githubIssueNumber || !issue.prUrl) throw new Error("Issue has no GitHub PR for review.");
  if (issue.prState === "MERGED") throw new Error("Merged PRs do not need review.");

  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  const qaPassed = labels.has("qa-passed") || labels.has("taskix:qa-passed");
  if (!qaPassed) throw new Error("Reviewer requires QA to pass first.");

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
  const appliedLabels = passed ? ["taskix:ready-to-merge"] : ["taskix:blocked"];
  const removedIssueLabels = labelsToRemove(issue.labels ?? []);
  const removedPrLabels = labelsToRemove(issue.prLabels ?? []);

  if (removedIssueLabels.length) await removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, removedIssueLabels);
  if (removedPrLabels.length) await removeLabelsWithGh(project.githubRepo, issue.prUrl, removedPrLabels);
  await addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, appliedLabels);
  await addLabelsWithGh(project.githubRepo, issue.prUrl, appliedLabels);
  await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, `Reviewer code review ${passed ? "passed" : "blocked"}.\n\n${review.summary}`);

  issue.labels = mergeLabels(issue.labels ?? [], removedIssueLabels, appliedLabels);
  issue.prLabels = mergeLabels(issue.prLabels ?? [], removedPrLabels, appliedLabels);
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

  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  if (!labels.has("taskix:ready-to-merge")) {
    throw new Error("Reviewer code review must pass before merge.");
  }

  await runArchitectMergeRequest(project, workflow, issue);
  await syncWorkflowUntilMerged(project, workflow.workflowId, issue.issueId);
}

async function runArchitectMergeRequest(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord): Promise<void> {
  const now = new Date().toISOString();
  const content = architectMergeInstruction(project, issue);

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
  const result = await codex.reviewerChat({
    projectName: project.name,
    githubRepo: project.githubRepo,
    message: content,
    sessionId: existingReviewerSession?.sessionId ?? null
  });
  const mergeDurationMs = Math.max(0, Date.now() - mergeStartedAt);
  const activeJobId = getActiveJobId();
  const finishedAt = new Date().toISOString();

  await appendAgentMessages({
    sessionKey,
    projectId: project.projectId,
    role: "reviewer",
    title: "Reviewer",
    sessionId: result.sessionId ?? existingReviewerSession?.sessionId ?? null,
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
        content: result.text,
        createdAt: finishedAt,
        updatedAt: finishedAt
      }
    ]
  });
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
    "Read the issue, PR state, checks, labels, comments, and mergeability with gh. Treat GitHub as the source of truth.",
    "Only merge if taskix:ready-to-merge is present and no blocker exists.",
    "If merged, apply taskix:merged and close the issue. If blocked by conflict or checks, report the blocker so Taskix can return it to developer."
  ].join("\n");
}

function labelsToRemove(labels: string[]): string[] {
  const lowerLabels = new Set(labels.map((label) => label.toLowerCase()));
  return removeReviewLabels.filter((label) => lowerLabels.has(label));
}

function mergeLabels(existing: string[], removed: string[], applied: string[]): string[] {
  const removedSet = new Set(removed.map((label) => label.toLowerCase()));
  return [...new Set([...existing.filter((label) => !removedSet.has(label.toLowerCase())), ...applied])];
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
