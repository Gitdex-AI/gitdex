import { CodexClient } from "@/lib/codex";
import { addLabelsWithGh, commentIssueWithGh, removeLabelsWithGh } from "@/lib/github-local";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, getAgentSession, getProject, getWorkflow, saveProject, saveWorkflow } from "@/lib/store";
import type { IssueRecord, ProjectRecord, WorkflowRecord } from "@/lib/types";

const removeReviewLabels = ["taskix:architect-review", "taskix:ready-to-merge", "taskix:blocked"];

export async function runWorkflowArchitectReview(workflowId: string, issueId: string, project?: ProjectRecord | null): Promise<void> {
  if (!project?.githubRepo) throw new Error("Project has no GitHub repo configured.");
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
  const issue = workflow.issues.find((item) => item.issueId === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found in workflow ${workflowId}`);
  if (!issue.githubIssueNumber || !issue.prUrl) throw new Error("Issue has no GitHub PR for architect review.");
  if (issue.prState === "MERGED") throw new Error("Merged PRs do not need architect review.");

  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  const qaPassed = labels.has("qa-passed") || labels.has("taskix:qa-passed");
  if (!qaPassed) throw new Error("Architect review requires QA to pass first.");

  const settings = await getSettings();
  const codex = new CodexClient(settings);
  const review = await codex.architectConfirmManualReady({
    repo: project.githubRepo,
    issueNumber: issue.githubIssueNumber,
    prUrl: issue.prUrl
  });

  const now = new Date().toISOString();
  const passed = review.decision === "ready_to_merge";
  const appliedLabels = passed ? ["taskix:ready-to-merge"] : ["taskix:blocked"];
  const removedIssueLabels = labelsToRemove(issue.labels ?? []);
  const removedPrLabels = labelsToRemove(issue.prLabels ?? []);

  if (removedIssueLabels.length) await removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, removedIssueLabels);
  if (removedPrLabels.length) await removeLabelsWithGh(project.githubRepo, issue.prUrl, removedPrLabels);
  await addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, appliedLabels);
  await addLabelsWithGh(project.githubRepo, issue.prUrl, appliedLabels);
  await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, `Architect code review ${passed ? "passed" : "blocked"}.\n\n${review.summary}`);

  issue.labels = mergeLabels(issue.labels ?? [], removedIssueLabels, appliedLabels);
  issue.prLabels = mergeLabels(issue.prLabels ?? [], removedPrLabels, appliedLabels);
  workflow.status = passed ? "in_progress" : "blocked";
  workflow.timeline.push(passed ? `Architect code review passed for ${issue.issueId}. Ready for merge.` : `Architect code review blocked ${issue.issueId}: ${review.summary}`);
  await saveWorkflow(workflow);

  await appendAgentMessages({
    sessionKey: `${project.projectId}:architect`,
    projectId: project.projectId,
    role: "architect",
    title: "Architect",
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    githubIssueNumber: issue.githubIssueNumber,
    githubIssueUrl: issue.githubIssueUrl ?? null,
    prUrl: issue.prUrl,
    labels: issue.prLabels,
    currentStep: passed ? "code review passed" : "code review blocked",
    status: passed ? "done" : "blocked",
    executionLogs: review.executionLog ? [{
      title: `Architect code review for ${issue.title}`,
      content: review.executionLog,
      createdAt: now,
      status: passed ? "ok" : "failed"
    }] : [],
    messages: [
      { role: "assistant", content: `Decision: ${review.decision}\n${review.summary}`, createdAt: now }
    ]
  });

  if (!passed) throw new Error(review.summary || "Architect review blocked this PR.");
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
    throw new Error("Architect code review must pass before merge.");
  }

  await runArchitectMergeRequest(project, workflow, issue);
}

async function runArchitectMergeRequest(project: ProjectRecord, workflow: WorkflowRecord, issue: IssueRecord): Promise<void> {
  const now = new Date().toISOString();
  const content = [
    "You are architect merge owner.",
    "",
    `GitHub repo: ${project.githubRepo}`,
    `Issue: ${issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : issue.issueId}`,
    `PR: ${issue.prUrl ?? "none"}`,
    "",
    "Read the issue, PR state, checks, labels, comments, and mergeability with gh. Treat GitHub as the source of truth.",
    "Only merge if taskix:ready-to-merge is present and no blocker exists.",
    "If merged, apply taskix:merged and close the issue. If blocked by conflict or checks, report the blocker so Taskix can return it to developer."
  ].join("\n");

  workflow.timeline.push(`Requested architect merge handling for ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const sessionKey = `${project.projectId}:architect`;
  const [settings, existingArchitectSession] = await Promise.all([
    getSettings(),
    getAgentSession(sessionKey)
  ]);
  const codex = new CodexClient(settings);
  const result = await codex.architectChat({
    projectName: project.name,
    githubRepo: project.githubRepo,
    message: content,
    sessionId: project.architectSessionId ?? existingArchitectSession?.sessionId ?? null
  });

  if (result.sessionId && result.sessionId !== project.architectSessionId) {
    project.architectSessionId = result.sessionId;
    await saveProject(project);
  }

  await appendAgentMessages({
    sessionKey,
    projectId: project.projectId,
    role: "architect",
    title: "Architect",
    sessionId: result.sessionId ?? project.architectSessionId ?? existingArchitectSession?.sessionId ?? null,
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    prUrl: issue.prUrl ?? null,
    labels: issue.labels ?? [],
    currentStep: "merge requested",
    executionLogs: result.executionLog ? [{
      title: "Architect merge handling",
      content: result.executionLog,
      createdAt: new Date().toISOString(),
      status: "ok"
    }] : [],
    messages: [
      { role: "user", content, createdAt: now },
      { role: "assistant", content: result.text, createdAt: new Date().toISOString() }
    ]
  });
}

function labelsToRemove(labels: string[]): string[] {
  const lowerLabels = new Set(labels.map((label) => label.toLowerCase()));
  return removeReviewLabels.filter((label) => lowerLabels.has(label));
}

function mergeLabels(existing: string[], removed: string[], applied: string[]): string[] {
  const removedSet = new Set(removed.map((label) => label.toLowerCase()));
  return [...new Set([...existing.filter((label) => !removedSet.has(label.toLowerCase())), ...applied])];
}
