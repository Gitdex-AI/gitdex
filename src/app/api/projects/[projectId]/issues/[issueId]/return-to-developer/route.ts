import { NextResponse } from "next/server";
import { commentIssueWithGh } from "@/lib/github-local";
import { getIssueStage, transitionIssueStage } from "@/lib/issue-stage";
import { cancelPendingJobs, createJob, getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { workflowWorkspaceHref } from "@/lib/workspace-url";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; issueId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, issueId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!project.githubRepo) return NextResponse.json({ error: "Project has no GitHub repo configured." }, { status: 400 });

  const workflows = await listProjectWorkflows(project.projectId);
  const workflow = workflows.find((item) => item.issues.some((issue) => issue.issueId === issueId));
  const issue = workflow?.issues.find((item) => item.issueId === issueId);
  if (!workflow || !issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  if (!issue.prUrl) return NextResponse.json({ error: "Issue has no pull request to return to developer." }, { status: 400 });
  if (issue.prState === "MERGED") return NextResponse.json({ error: "Merged issues cannot be returned to developer." }, { status: 409 });

  const stage = getIssueStage(issue);
  if (!["gd:review", "gd:merge", "gd:fix", "gd:rebase"].includes(stage)) return NextResponse.json({ error: "Issue is not ready to return to developer." }, { status: 409 });

  const comment = [
    "This PR was returned to developer.",
    "",
    "Reason: QA, reviewer, or merge handling found this PR needs developer rework before it can continue.",
    "",
    "Developer action:",
    "- Rebase or merge latest `main` into the PR branch if merge handling reported conflicts.",
    "- Address QA findings or merge blockers called out in the workflow session.",
    "- Push the branch and report verification commands.",
    "- Request QA recheck because the branch changed after the previous QA pass."
  ].join("\n");

  try {
    if (issue.githubIssueNumber) {
      await transitionIssueStage({ repo: project.githubRepo, issue, stage: stage === "gd:rebase" ? "gd:rebase" : "gd:fix", prUrl: issue.prUrl });
      await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, comment);
    }
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to return issue to developer.",
      action: "Check GitHub connectivity and retry Return to developer. Local workflow state was not changed."
    }, { status: 502 });
  }

  workflow.status = "in_progress";
  workflow.timeline.push(`Returned ${issue.issueId} to developer for branch update/rebase before merge.`);
  await saveWorkflow(workflow);

  await cancelPendingJobs({
    projectId: project.projectId,
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    type: "qa_run",
    reason: `Superseded because ${issue.issueId} was returned to developer for PR rework.`
  });
  const existingJob = (await listJobs(project.projectId)).find((job) => (
    job.type === "issue_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));
  const job = existingJob ?? await createJob({
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

  return NextResponse.json({ ok: true, jobId: job.jobId, redirectTo: workflowWorkspaceHref({ projectId: project.projectId, workflowId: workflow.workflowId, autorun: true }) });
}
