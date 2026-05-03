import { NextResponse } from "next/server";
import { agentJobMessageId } from "@/lib/agent-run-messages";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { getJob, getProject, getWorkflow, listAgentSessions, saveAgentSession, saveJob, saveWorkflow } from "@/lib/store";
import type { AgentMessage, AgentSessionRecord, JobRecord } from "@/lib/types";

const terminalSessionStatuses = new Set<AgentSessionRecord["status"]>(["done", "blocked"]);

export async function POST(_request: Request, context: { params: Promise<unknown> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, jobId } = await context.params as { projectId: string; jobId: string };
  const [project, job] = await Promise.all([getProject(projectId), getJob(jobId)]);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!job || job.projectId !== project.projectId) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "running") return NextResponse.json({ error: "Only running jobs can be resolved." }, { status: 409 });

  const sessions = await listAgentSessions(project.projectId);
  const session = findJobSession(job, sessions);
  if (!session || !terminalSessionStatuses.has(session.status)) {
    return NextResponse.json({
      error: "No completed agent session found for this running job.",
      action: "Use Recover if the agent did not finish, or wait for the job to complete."
    }, { status: 409 });
  }

  const now = new Date().toISOString();
  const resolvedStatus = session.status === "done" ? "done" : "failed";
  job.status = resolvedStatus;
  job.error = resolvedStatus === "done" ? null : `Resolved from ${session.role} session status: ${session.status}.`;
  job.updatedAt = now;
  job.runtime = { ...(job.runtime ?? {}), finishedAt: job.runtime?.finishedAt ?? session.finishedAt ?? now };

  const messageId = agentJobMessageId(job.jobId);
  const messageStatus: AgentMessage["status"] = session.status === "done" ? "done" : "blocked";
  const messages: AgentMessage[] = session.messages.map((message) => (
    message.messageId === messageId
      ? {
          ...message,
          status: messageStatus,
          content: message.content.includes("working")
            ? `Status resolved: ${roleLabel(session)} session was already ${session.status}.`
            : message.content,
          updatedAt: now,
          durationMs: session.durationMs ?? message.durationMs ?? elapsedMs(job.runtime?.startedAt, session.finishedAt ?? now)
        }
      : message
  ));

  await saveAgentSession({
    ...session,
    messages,
    updatedAt: now
  });
  await saveJob(job);

  const workflow = await getWorkflow(job.payload.workflowId);
  if (workflow) {
    workflow.timeline.push(`Resolved stale ${job.type} job ${job.jobId} from completed ${session.role} session.`);
    await saveWorkflow(workflow);
  }

  return NextResponse.json({ ok: true, jobId: job.jobId, runStatus: job.status, sessionStatus: session.status });
}

function findJobSession(job: JobRecord, sessions: AgentSessionRecord[]): AgentSessionRecord | null {
  if (!job.payload.issueId) {
    if (job.type === "workflow_run") return sessions.find((session) => session.role === "planner" && session.workflowId === job.payload.workflowId) ?? null;
    return null;
  }
  if (job.type === "architect_blocker_run") {
    return sessions.find((session) => session.role === "architect" && session.issueId === job.payload.issueId)
      ?? sessions.find((session) => session.sessionKey === job.payload.sessionKey)
      ?? null;
  }
  if (job.type === "architect_review_run" || job.type === "merge_run") {
    return sessions.find((session) => session.role === "reviewer" && session.issueId === job.payload.issueId) ?? null;
  }
  const expectedRole = job.type === "qa_run" ? "qa" : "developer";
  return sessions.find((session) => session.role === expectedRole && session.issueId === job.payload.issueId) ?? null;
}

function roleLabel(session: AgentSessionRecord): string {
  if (session.role === "qa") return "QA";
  if (session.role === "developer") return session.developerRole ?? "Developer";
  if (session.role === "architect") return "Architect";
  if (session.role === "planner") return "Planner";
  if (session.role === "reviewer") return "Reviewer";
  return "Agent";
}

function elapsedMs(startedAt?: string | null, finishedAt?: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : null;
}
