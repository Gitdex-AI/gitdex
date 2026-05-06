import { NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { getIssueStage, transitionIssueStage } from "@/lib/issue-stage";
import { getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";

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
  if (issue.githubState === "CLOSED" || issue.prState === "MERGED") return NextResponse.json({ error: "Completed issues cannot be reset." }, { status: 409 });
  if (getIssueStage(issue) !== "gd:blocked") return NextResponse.json({ error: "Only blocked issues can be reset." }, { status: 409 });

  const jobs = await listJobs(project.projectId);
  const activeJob = jobs.find((job) => (
    (job.status === "pending" || job.status === "running")
    && ["issue_run", "qa_run", "blocker_analysis_run", "architect_blocker_run", "architect_review_run", "merge_run"].includes(job.type)
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));
  if (activeJob) return NextResponse.json({ error: "Issue already has an active job." }, { status: 409 });

  try {
    await transitionIssueStage({ repo: project.githubRepo, issue, stage: "gd:dev", prUrl: issue.prUrl ?? null });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to reset blocked issue.",
      action: "Check GitHub connectivity and retry Reset. Local workflow state was not changed."
    }, { status: 502 });
  }

  workflow.status = "in_progress";
  workflow.timeline.push(`Reset ${issue.issueId} from blocked to dev.`);
  await saveWorkflow(workflow);

  return NextResponse.json({ ok: true, stage: "gd:dev" });
}
