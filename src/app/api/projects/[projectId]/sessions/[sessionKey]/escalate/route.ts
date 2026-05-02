import { NextResponse } from "next/server";
import { createJob, getAgentSession, getProject, listJobs } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; sessionKey: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, sessionKey } = await params;
  const decodedSessionKey = decodeURIComponent(sessionKey);
  const [project, session] = await Promise.all([getProject(projectId), getAgentSession(decodedSessionKey)]);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!session || session.projectId !== project.projectId) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  if (!session.workflowId || !session.issueId) return NextResponse.json({ error: "Session is not linked to a workflow issue." }, { status: 400 });

  const existingJob = (await listJobs(project.projectId)).find((job) => (
    job.type === "architect_blocker_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === session.workflowId
    && job.payload.issueId === session.issueId
    && job.payload.sessionKey === session.sessionKey
  ));
  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "architect_blocker_run",
    payload: {
      workflowId: session.workflowId,
      issueId: session.issueId,
      sessionKey: session.sessionKey
    }
  });

  return NextResponse.json({
    ok: true,
    jobId: job.jobId,
    runStatus: job.status,
    sessionKey: session.sessionKey
  });
}
