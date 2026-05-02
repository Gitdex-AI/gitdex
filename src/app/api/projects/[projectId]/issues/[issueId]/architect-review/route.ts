import { NextResponse } from "next/server";
import { CodexClient } from "@/lib/codex";
import { addLabelsWithGh, commentIssueWithGh, removeLabelsWithGh } from "@/lib/github-local";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, getProject, listProjectWorkflows, saveWorkflow } from "@/lib/store";

const removeReviewLabels = ["taskix:architect-review", "taskix:ready-to-merge", "taskix:blocked"];

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; issueId: string }> }) {
  const { projectId, issueId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!project.githubRepo) return NextResponse.json({ error: "Project has no GitHub repo configured." }, { status: 400 });

  const workflows = await listProjectWorkflows(project.projectId);
  const workflow = workflows.find((item) => item.issues.some((issue) => issue.issueId === issueId));
  const issue = workflow?.issues.find((item) => item.issueId === issueId);
  if (!workflow || !issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  if (!issue.githubIssueNumber || !issue.prUrl) return NextResponse.json({ error: "Issue has no GitHub PR for architect review." }, { status: 400 });
  if (issue.prState === "MERGED") return NextResponse.json({ error: "Merged PRs do not need architect review." }, { status: 409 });

  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  const qaPassed = labels.has("qa-passed") || labels.has("taskix:qa-passed");
  if (!qaPassed) return NextResponse.json({ error: "Architect review requires QA to pass first." }, { status: 409 });

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

  try {
    if (removedIssueLabels.length) await removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, removedIssueLabels);
    if (removedPrLabels.length) await removeLabelsWithGh(project.githubRepo, issue.prUrl, removedPrLabels);
    await addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, appliedLabels);
    await addLabelsWithGh(project.githubRepo, issue.prUrl, appliedLabels);
    await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, `Architect code review ${passed ? "passed" : "blocked"}.\n\n${review.summary}`);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to apply architect review labels.",
      action: "Check GitHub connectivity and retry architect review."
    }, { status: 502 });
  }

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

  return NextResponse.json({
    ok: passed,
    decision: review.decision,
    message: review.summary,
    prUrl: issue.prUrl
  }, { status: passed ? 200 : 409 });
}

function labelsToRemove(labels: string[]): string[] {
  const lowerLabels = new Set(labels.map((label) => label.toLowerCase()));
  return removeReviewLabels.filter((label) => lowerLabels.has(label));
}

function mergeLabels(existing: string[], removed: string[], applied: string[]): string[] {
  const removedSet = new Set(removed.map((label) => label.toLowerCase()));
  return [...new Set([...existing.filter((label) => !removedSet.has(label.toLowerCase())), ...applied])];
}
