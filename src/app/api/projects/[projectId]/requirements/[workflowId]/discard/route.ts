import { NextResponse } from "next/server";
import { isDiscardableDraftWorkflow } from "@/lib/draft-workflow";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { deleteAgentSession, deleteWorkflow, getProject, getWorkflow } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; workflowId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, workflowId } = await params;
  const [project, workflow] = await Promise.all([getProject(projectId), getWorkflow(workflowId)]);
  if (!project) return redirect(request, `/projects?error=${encodeURIComponent("Project not found.")}`);
  if (!workflow) return redirect(request, `/projects/${project.projectId}?phase=requirements&error=${encodeURIComponent("Draft not found.")}`);
  if (!isDiscardableDraftWorkflow(project.projectId, workflow)) {
    return redirect(request, `/projects/${project.projectId}?workflow=${encodeURIComponent(workflow.workflowId)}&phase=requirements&error=${encodeURIComponent("Only unconfirmed draft requirements can be discarded.")}`);
  }

  await deleteWorkflow(workflow.workflowId);
  await deleteAgentSession(`${project.projectId}:workflow:${workflow.workflowId}:product_manager`);
  return redirect(request, `/projects/${project.projectId}?phase=requirements&message=${encodeURIComponent("Draft requirement discarded.")}`);
}

function redirect(request: Request, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}
