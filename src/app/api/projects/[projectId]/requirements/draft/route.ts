import { NextResponse } from "next/server";
import { findOrCreateDraftWorkflow } from "@/lib/orchestrator";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { getProject } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.redirect(new URL(`/?error=${encodeURIComponent("Project not found.")}`, request.url), { status: 303 });

  const workflow = await findOrCreateDraftWorkflow(project);
  const next = new URL(`/projects/${project.projectId}`, request.url);
  next.searchParams.set("workflow", workflow.workflowId);
  next.searchParams.set("phase", "requirements");
  return NextResponse.redirect(next, { status: 303 });
}
