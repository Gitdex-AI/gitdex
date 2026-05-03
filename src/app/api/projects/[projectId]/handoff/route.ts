import { NextResponse } from "next/server";
import { createWorkflow } from "@/lib/orchestrator";
import { findReadyForArchitectPayload, formatPmHandoffPayload, parseReadyForArchitectPayload } from "@/lib/pm-handoff";
import { createJob, getAgentSession, getProject } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return redirect(request, `/projects?error=${encodeURIComponent("Project not found.")}`);

  const form = await request.formData();
  const submittedPayload = parseReadyForArchitectPayload(String(form.get("payload") ?? ""));
  const directRequirement = String(form.get("requirement") ?? "").trim();
  const pmSession = await getAgentSession(`${project.projectId}:product_manager`);
  const payload = submittedPayload ?? findReadyForArchitectPayload(pmSession);
  if (!payload && !directRequirement) {
    return redirect(request, `/projects/${project.projectId}?role=product_manager&error=${encodeURIComponent("Enter a requirement or use PM chat to produce ready_for_architect JSON.")}`);
  }

  try {
    const requirement = payload ? formatPmHandoffPayload(payload) : directRequirement;
    const workflow = await createWorkflow(requirement, 0, project);
    const job = await createJob({
      projectId: project.projectId,
      type: "workflow_run",
      payload: { workflowId: workflow.workflowId }
    });
    const next = new URL(`/projects/${project.projectId}`, request.url);
    next.searchParams.set("role", "product_manager");
    next.searchParams.set("phase", "requirements");
    next.searchParams.set("queued", "1");
    next.searchParams.set("workflow", workflow.workflowId);
    next.searchParams.set("job", job.jobId);
    return NextResponse.redirect(next, { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Architect handoff failed.";
    return redirect(request, `/projects/${project.projectId}?role=product_manager&error=${encodeURIComponent(message)}`);
  }
}

function redirect(request: Request, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}
