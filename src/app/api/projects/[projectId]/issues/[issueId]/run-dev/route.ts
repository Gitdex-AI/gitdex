import { NextResponse } from "next/server";
import { createJob, getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { getIssueStage } from "@/lib/issue-stage";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; issueId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, issueId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const workflows = await listProjectWorkflows(project.projectId);
  const workflow = workflows.find((item) => item.issues.some((issue) => issue.issueId === issueId));
  const issue = workflow?.issues.find((item) => item.issueId === issueId);
  if (!workflow || !issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  if (issue.prState === "MERGED") return NextResponse.json({ error: "Merged issues cannot run developer work." }, { status: 409 });
  const stage = getIssueStage(issue);
  if (!["gd:dev", "gd:fix", "gd:rebase"].includes(stage)) return NextResponse.json({ error: `Issue is ${stage}; developer work is not the next action.` }, { status: 409 });

  const jobs = await listJobs(project.projectId);
  const existingJob = jobs.find((job) => (
    job.type === "issue_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));

  workflow.status = "in_progress";
  workflow.timeline.push(existingJob ? `Developer job already queued for ${issue.issueId}.` : `Developer job queued for ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "issue_run",
    payload: {
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      prUrl: issue.prUrl ?? null,
      branch: issue.branch ?? null,
      returnedFromQa: false,
      previousPrUrl: issue.prUrl ?? null
    }
  });

  return NextResponse.json({
    ok: true,
    jobId: job.jobId,
    runStatus: job.status,
    redirectTo: `/projects/${project.projectId}/workflows/${workflow.workflowId}?autorun=1&job=${job.jobId}`
  });
}
