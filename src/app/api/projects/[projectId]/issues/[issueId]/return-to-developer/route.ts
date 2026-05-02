import { NextResponse } from "next/server";
import { addLabelsWithGh, commentIssueWithGh, removeLabelsWithGh } from "@/lib/github-local";
import { cancelPendingJobs, createJob, getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

const removeReadyLabels = ["qa-passed", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:spec-blocked", "taskix:ready-to-merge", "taskix:need-qa", "taskix:qa-running", "taskix:blocked"];
const addDeveloperLabels = ["taskix:dev-running"];

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

  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  const canReturnToDeveloper = labels.has("qa-passed")
    || labels.has("taskix:qa-passed")
    || labels.has("taskix:ready-to-merge")
    || labels.has("qa-failed")
    || labels.has("taskix:qa-failed");
  if (!canReturnToDeveloper) return NextResponse.json({ error: "Issue is not ready to return to developer." }, { status: 409 });

  const issueLabelsToRemove = labelsToRemove(issue.labels ?? []);
  const prLabelsToRemove = labelsToRemove(issue.prLabels ?? []);
  const comment = [
    "This PR was returned to developer.",
    "",
    "Reason: QA or architect merge handling found this PR needs developer rework before it can continue.",
    "",
    "Developer action:",
    "- Rebase or merge latest `main` into the PR branch if merge handling reported conflicts.",
    "- Address QA findings or merge blockers called out in the workflow session.",
    "- Push the branch and report verification commands.",
    "- Request QA recheck because the branch changed after the previous QA pass."
  ].join("\n");

  try {
    if (issue.githubIssueNumber) {
      if (issueLabelsToRemove.length) await removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, issueLabelsToRemove);
      await addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, addDeveloperLabels);
      await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, comment);
    }
    if (prLabelsToRemove.length) await removeLabelsWithGh(project.githubRepo, issue.prUrl, prLabelsToRemove);
    await addLabelsWithGh(project.githubRepo, issue.prUrl, addDeveloperLabels);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to return issue to developer.",
      action: "Check GitHub connectivity and retry Return to developer. Local workflow state was not changed."
    }, { status: 502 });
  }

  issue.labels = [
    ...new Set([
      ...(issue.labels ?? []).filter((label) => !removeReadyLabels.includes(label.toLowerCase())),
      ...addDeveloperLabels
    ])
  ];
  issue.prLabels = [
    ...new Set([
      ...(issue.prLabels ?? []).filter((label) => !removeReadyLabels.includes(label.toLowerCase())),
      ...addDeveloperLabels
    ])
  ];
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

  return NextResponse.json({ ok: true, jobId: job.jobId, redirectTo: `/projects/${project.projectId}/workflows/${workflow.workflowId}?autorun=1` });
}

function labelsToRemove(labels: string[]): string[] {
  const lowerLabels = new Set(labels.map((label) => label.toLowerCase()));
  return removeReadyLabels.filter((label) => lowerLabels.has(label));
}
