import { NextResponse } from "next/server";
import { CodexClient } from "@/lib/codex";
import { chatRoleLabel, parseChatTarget } from "@/lib/chat-routing";
import { findOrCreateDraftWorkflow } from "@/lib/orchestrator";
import { runJobById } from "@/lib/job-runner";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, createJob, getAgentSession, getProject, getWorkflow, saveProject } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const form = await request.formData();
  const rawMessage = String(form.get("message") ?? "").trim();
  const submittedWorkflowId = String(form.get("workflowId") ?? "").trim();
  const target = parseChatTarget(rawMessage);
  if (!target.message) return redirect(request, `/projects/${projectId}?error=${encodeURIComponent("Message is required.")}`);
  if (target.mention && target.message === rawMessage) {
    return redirect(request, `/projects/${projectId}?error=${encodeURIComponent(`@${target.mention} is not a supported chat target yet. Use @PM, @architect, or @devops.`)}`);
  }

  const [project, settings] = await Promise.all([getProject(projectId), getSettings()]);
  if (!project) return redirect(request, `/projects?error=${encodeURIComponent("Project not found.")}`);

  const role = target.role;
  const message = target.message;
  const submittedWorkflow = role === "product_manager" && submittedWorkflowId ? await getWorkflow(submittedWorkflowId) : null;
  const workflow = role === "product_manager"
    ? submittedWorkflow?.projectId === project.projectId
      ? submittedWorkflow
      : await findOrCreateDraftWorkflow(project)
    : null;
  const workflowId = workflow?.workflowId ?? null;
  const sessionKey = role === "product_manager" && workflowId
    ? `${project.projectId}:workflow:${workflowId}:product_manager`
    : `${project.projectId}:${role}`;
  const existing = await getAgentSession(sessionKey);
  const codex = new CodexClient(settings);
  let projectMemory: string | null = null;
  const isFirstPmMessage = role === "product_manager" && workflowId && !existing?.messages.length;
  if (isFirstPmMessage) {
    projectMemory = await codex.readProjectMemory({ projectName: project.name, githubRepo: project.githubRepo });
    if (!projectMemory) {
      const memoryJob = await createJob({
        projectId: project.projectId,
        type: "memory_init",
        payload: { workflowId }
      });
      await runJobById(memoryJob.jobId, project.projectId);
      projectMemory = await codex.readProjectMemory({ projectName: project.name, githubRepo: project.githubRepo });
    }
  }
  const currentSessionId = role === "product_manager" && workflowId
    ? existing?.sessionId ?? null
    : role === "product_manager"
      ? project.projectManagerSessionId
      : role === "architect"
        ? project.architectSessionId
        : project.devopsSessionId;
  const codexStartedAt = Date.now();
  const result = role === "product_manager"
    ? await codex.projectManagerChat({ projectName: project.name, githubRepo: project.githubRepo, message, projectMemory, workflowConfirmed: Boolean(workflow?.trackingCode), sessionId: currentSessionId ?? existing?.sessionId })
    : role === "architect"
      ? await codex.architectChat({ projectName: project.name, githubRepo: project.githubRepo, message, sessionId: currentSessionId ?? existing?.sessionId })
      : await codex.devopsChat({ projectName: project.name, githubRepo: project.githubRepo, message, sessionId: currentSessionId ?? existing?.sessionId });
  const codexDurationMs = Math.max(0, Date.now() - codexStartedAt);

  if (role === "product_manager" && !workflowId && result.sessionId && result.sessionId !== project.projectManagerSessionId) {
    project.projectManagerSessionId = result.sessionId;
    await saveProject(project);
  }
  if (role === "architect" && result.sessionId && result.sessionId !== project.architectSessionId) {
    project.architectSessionId = result.sessionId;
    await saveProject(project);
  }
  if (role === "devops" && result.sessionId && result.sessionId !== project.devopsSessionId) {
    project.devopsSessionId = result.sessionId;
    await saveProject(project);
  }

  const now = new Date().toISOString();
  await appendAgentMessages({
    sessionKey,
    projectId: project.projectId,
    role,
    title: chatRoleLabel(role),
    sessionId: result.sessionId ?? currentSessionId ?? existing?.sessionId ?? null,
    workflowId,
    executionLogs: result.executionLog ? [{
      title: `${chatRoleLabel(role)} Codex execution`,
      content: result.executionLog,
      createdAt: new Date().toISOString(),
      status: "ok",
      durationMs: codexDurationMs
    }] : [],
    messages: [
      { role: "user", content: message, createdAt: now },
      { role: "assistant", content: result.text, createdAt: new Date().toISOString() }
    ]
  });

  const next = new URL(`/projects/${project.projectId}`, request.url);
  if (workflowId) {
    next.searchParams.set("workflow", workflowId);
    next.searchParams.set("phase", "requirements");
  }
  return NextResponse.redirect(next, { status: 303 });
}

function redirect(request: Request, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}
