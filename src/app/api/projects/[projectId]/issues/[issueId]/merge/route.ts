import { NextResponse } from "next/server";
import { closeIssueWithGh, mergePullRequestWithGh } from "@/lib/github-local";
import { getProject, listProjectWorkflows, saveWorkflow } from "@/lib/store";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; issueId: string }> }) {
  const { projectId, issueId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const workflows = await listProjectWorkflows(project.projectId);
  const workflow = workflows.find((item) => item.issues.some((issue) => issue.issueId === issueId));
  const issue = workflow?.issues.find((item) => item.issueId === issueId);
  if (!workflow || !issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  if (!issue.prUrl) return NextResponse.json({ error: "Issue has no pull request to merge." }, { status: 400 });
  if (issue.prState === "MERGED") return NextResponse.json({ ok: true, merged: true, issueId, prUrl: issue.prUrl });

  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  const isReady = labels.has("qa-passed") || labels.has("taskix:qa-passed") || labels.has("taskix:ready-to-merge");
  if (!isReady) return NextResponse.json({ error: "Issue is not QA-passed or ready to merge." }, { status: 409 });

  const mergedLabels = ["taskix:merged"];
  let closeIssueWarning: string | null = null;

  try {
    await mergePullRequestWithGh(project.githubRepo, issue.prUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PR merge failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  issue.prState = "MERGED";
  issue.labels = [...new Set([...(issue.labels ?? []), ...mergedLabels])];
  issue.prLabels = [...new Set([...(issue.prLabels ?? []), ...mergedLabels])];
  workflow.timeline.push(`Merged PR ${issue.prUrl} for issue ${issue.issueId}.`);

  if (issue.githubIssueNumber) {
    try {
      await closeIssueWithGh(project.githubRepo, issue.githubIssueNumber, `Closed after PR ${issue.prUrl} was merged by Taskix.`);
      issue.githubState = "CLOSED";
      workflow.timeline.push(`Closed GitHub issue #${issue.githubIssueNumber} after merge.`);
    } catch (error) {
      closeIssueWarning = error instanceof Error ? error.message : "GitHub issue close failed.";
      workflow.timeline.push(`GitHub issue #${issue.githubIssueNumber} close failed after merge: ${closeIssueWarning}`);
    }
  } else {
    issue.githubState = "CLOSED";
  }

  if (workflow.issues.every((item) => item.prState === "MERGED" || item.githubState === "CLOSED")) {
    workflow.status = "done";
    workflow.timeline.push("Workflow completed after all issue PRs merged.");
  }
  await saveWorkflow(workflow);

  return NextResponse.json({ ok: true, merged: true, issueClosed: !closeIssueWarning, warning: closeIssueWarning, issueId, prUrl: issue.prUrl });
}
