import { NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { getIssueStage } from "@/lib/issue-stage";
import { createJob, getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
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
  if (issue.githubState === "CLOSED" || issue.prState === "MERGED") return NextResponse.json({ error: "Completed issues do not need blocker analysis." }, { status: 409 });
  if (getIssueStage(issue) !== "gd:blocked") return NextResponse.json({ error: "Only blocked issues can be analyzed." }, { status: 409 });

  const jobs = await listJobs(project.projectId);
  const existingJob = jobs.find((job) => (
    job.type === "blocker_analysis_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));

  workflow.status = "in_progress";
  workflow.timeline.push(existingJob ? `Blocker analysis already queued for ${issue.issueId}.` : `Blocker analysis queued for ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "blocker_analysis_run",
    payload: {
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      prUrl: issue.prUrl ?? null,
      branch: issue.branch ?? null
    }
  });

  return NextResponse.json({
    ok: true,
    jobId: job.jobId,
    runStatus: job.status,
    redirectTo: workflowWorkspaceHref({ projectId: project.projectId, workflowId: workflow.workflowId, jobId: job.jobId, autorun: true })
  });
}
