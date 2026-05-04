import { NextResponse } from "next/server";
import { createDraftWorkflow } from "@/lib/orchestrator";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { appendAgentMessages, getProject } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.redirect(new URL(`/?error=${encodeURIComponent("Project not found.")}`, request.url), { status: 303 });

  const form = await request.formData();
  const draftMessage = String(form.get("draftMessage") ?? "").trim();
  if (!draftMessage) {
    const next = new URL(`/projects/${project.projectId}`, request.url);
    next.searchParams.set("phase", "requirements");
    next.searchParams.set("error", "New requirement draft message is missing.");
    return NextResponse.redirect(next, { status: 303 });
  }

  const workflow = await createDraftWorkflow(project);
  await appendAgentMessages({
    sessionKey: `${project.projectId}:workflow:${workflow.workflowId}:product_manager`,
    projectId: project.projectId,
    role: "product_manager",
    title: "PM",
    workflowId: workflow.workflowId,
    status: "active",
    messages: [{
      role: "user",
      content: draftMessage,
      createdAt: new Date().toISOString()
    }]
  });

  const next = new URL(`/projects/${project.projectId}`, request.url);
  next.searchParams.set("workflow", workflow.workflowId);
  next.searchParams.set("phase", "requirements");
  return NextResponse.redirect(next, { status: 303 });
}
