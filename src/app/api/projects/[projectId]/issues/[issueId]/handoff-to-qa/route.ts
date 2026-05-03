import { NextResponse } from "next/server";
import { getPullRequestHeadShaWithGh } from "@/lib/github-local";
import { getIssueStage, transitionIssueStage } from "@/lib/issue-stage";
import { allocateQaPreviewPort, qaPreviewUrl } from "@/lib/qa-preview-port";
import { cancelPendingJobs, createJob, getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

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
  if (!issue.prUrl) return NextResponse.json({ error: "Issue has no pull request for QA." }, { status: 400 });
  if (issue.prState === "MERGED") return NextResponse.json({ error: "Merged issues cannot be sent to QA." }, { status: 409 });
  if (getIssueStage(issue) !== "gd:qa" && getIssueStage(issue) !== "gd:blocked") return NextResponse.json({ error: "Issue is not in QA stage." }, { status: 409 });

  let headSha: string | null = null;
  try {
    headSha = await getPullRequestHeadShaWithGh(project.githubRepo, issue.prUrl);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to read PR head SHA.",
      action: "Check GitHub connectivity and retry Handoff to QA. No QA job was queued."
    }, { status: 502 });
  }
  const jobs = await listJobs(project.projectId);
  const qaAttempt = nextQaAttempt(jobs, workflow.workflowId, issue.issueId);
  const previewPort = allocateQaPreviewPort(jobs);
  const previewUrl = qaPreviewUrl(previewPort);
  try {
    await transitionIssueStage({ repo: project.githubRepo, issue, stage: "gd:qa", prUrl: issue.prUrl });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to hand off issue to QA.",
      action: "Check GitHub connectivity and retry Handoff to QA. Local workflow state was not changed."
    }, { status: 502 });
  }

  workflow.status = "in_progress";
  workflow.timeline.push(`Handed ${issue.issueId} to QA.`);
  await saveWorkflow(workflow);

  await cancelPendingJobs({
    projectId: project.projectId,
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    type: "qa_run",
    reason: `Superseded by QA handoff attempt ${qaAttempt} for ${issue.prUrl}.`
  });
  const existingJob = (await listJobs(project.projectId)).find((job) => (
    job.type === "qa_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));
  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "qa_run",
    payload: { workflowId: workflow.workflowId, issueId: issue.issueId, prUrl: issue.prUrl, branch: issue.branch ?? null, headSha, qaAttempt, previewPort, previewUrl }
  });

  return NextResponse.json({ ok: true, jobId: job.jobId, redirectTo: `/projects/${project.projectId}/workflows/${workflow.workflowId}?autorun=1` });
}

function nextQaAttempt(jobs: Awaited<ReturnType<typeof listJobs>>, workflowId: string, issueId: string): number {
  return jobs
    .filter((job) => job.type === "qa_run" && job.payload.workflowId === workflowId && job.payload.issueId === issueId)
    .map((job) => job.payload.qaAttempt ?? 0)
    .reduce((max, value) => Math.max(max, value), 0) + 1;
}
