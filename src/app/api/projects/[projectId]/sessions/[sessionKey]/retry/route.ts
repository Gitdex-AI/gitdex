import { NextResponse } from "next/server";
import { createJob, getAgentSession, getProject, getWorkflow, listJobs, saveAgentSession, saveWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; sessionKey: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, sessionKey } = await params;
  const [project, session] = await Promise.all([getProject(projectId), getAgentSession(decodeURIComponent(sessionKey))]);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!session || session.projectId !== project.projectId) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  if (!session.workflowId || !session.issueId) return NextResponse.json({ error: "Session has no workflow issue to retry." }, { status: 400 });

  const workflow = await getWorkflow(session.workflowId);
  if (!workflow) return NextResponse.json({ error: "Workflow not found." }, { status: 404 });

  workflow.status = "in_progress";
  workflow.timeline.push(`Retry requested for ${session.issueId} after tool/runtime blocker.`);
  await saveWorkflow(workflow);

  session.status = "active";
  session.currentStep = "developer retry queued";
  session.labels = [...new Set((session.labels ?? []).filter((label) => !["gitdex:blocked", "gitdex:planned"].includes(label.toLowerCase())))];
  session.updatedAt = new Date().toISOString();
  await saveAgentSession(session);

  const existingJob = (await listJobs(project.projectId)).find((job) => (
    job.type === "issue_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === session.workflowId
    && job.payload.issueId === session.issueId
  ));
  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "issue_run",
    payload: { workflowId: session.workflowId, issueId: session.issueId }
  });

  return NextResponse.json({
    ok: true,
    jobId: job.jobId,
    runStatus: job.status,
    redirectTo: `/projects/${project.projectId}/workflows/${session.workflowId}?autorun=1`
  });
}
