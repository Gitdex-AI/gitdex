import { NextResponse } from "next/server";
import { appendAgentRunPlaceholder } from "@/lib/agent-run-messages";
import { architectBlockerInstruction } from "@/lib/architect-blocker-runner";
import { appendAgentMessages, createJob, getAgentSession, getProject, listJobs } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { requestAutoRunPause } from "@/lib/auto-run-control";

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
  const architectSessionKey = `${session.issueId}:architect`;
  const architectInstruction = architectBlockerInstruction(session);
  const existingArchitectSession = await getAgentSession(architectSessionKey);
  if (!existingArchitectSession?.messages.some((message) => message.content === architectInstruction)) {
    const startedAt = new Date().toISOString();
    await appendAgentMessages({
      sessionKey: architectSessionKey,
      projectId: project.projectId,
      role: "architect",
      title: "Architect",
      sessionId: existingArchitectSession?.sessionId ?? null,
      workflowId: session.workflowId,
      issueId: session.issueId,
      githubIssueNumber: session.githubIssueNumber ?? null,
      githubIssueUrl: session.githubIssueUrl ?? null,
      prUrl: session.prUrl ?? null,
      labels: session.labels ?? [],
      status: "active",
      currentStep: "resolving blocker",
      startedAt,
      messages: [
        { role: "user", content: architectInstruction, createdAt: startedAt }
      ]
    });
  }
  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "architect_blocker_run",
    payload: {
      workflowId: session.workflowId,
      issueId: session.issueId,
      sessionKey: session.sessionKey
    }
  });
  await appendAgentRunPlaceholder({
    project,
    job,
    sessionKey: architectSessionKey,
    role: "architect",
    title: "Architect",
    label: "Architect",
    sessionId: existingArchitectSession?.sessionId ?? null,
    currentStep: "resolving blocker",
    workflow: session.workflowId ? { workflowId: session.workflowId } : null,
    issue: session.issueId ? {
      issueId: session.issueId,
      githubIssueNumber: session.githubIssueNumber ?? null,
      githubIssueUrl: session.githubIssueUrl ?? null,
      prUrl: session.prUrl ?? null,
      ownedPaths: session.ownedPaths ?? []
    } : null,
    githubIssueNumber: session.githubIssueNumber ?? null,
    githubIssueUrl: session.githubIssueUrl ?? null,
    prUrl: session.prUrl ?? null,
    labels: session.labels ?? []
  });
  requestAutoRunPause(project.projectId, "Auto Run pause requested because a blocked issue was manually sent to Architect.");

  return NextResponse.json({
    ok: true,
    jobId: job.jobId,
    runStatus: job.status,
    sessionKey: session.sessionKey
  });
}
