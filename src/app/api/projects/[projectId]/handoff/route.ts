import { NextResponse } from "next/server";
import { runJobById } from "@/lib/job-runner";
import { confirmWorkflowRequirement, createWorkflow } from "@/lib/orchestrator";
import { findReadyForPlannerPayload, formatPmHandoffPayload, parseReadyForPlannerPayload } from "@/lib/pm-handoff";
import { createJob, getAgentSession, getProject, getWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return redirect(request, `/?error=${encodeURIComponent("Project not found.")}`);

  const form = await request.formData();
  const workflowId = String(form.get("workflowId") ?? "").trim();
  const submittedPayload = parseReadyForPlannerPayload(String(form.get("payload") ?? ""));
  const directRequirement = String(form.get("requirement") ?? "").trim();
  const runPlanner = String(form.get("runPlanner") ?? "") === "1";
  const selectedWorkflow = workflowId ? await getWorkflow(workflowId) : null;
  const selectedPmSession = selectedWorkflow?.projectId === project.projectId
    ? await getAgentSession(`${project.projectId}:workflow:${selectedWorkflow.workflowId}:product_manager`)
    : null;
  const pmSession = selectedPmSession ?? await getAgentSession(`${project.projectId}:product_manager`);
  const payload = submittedPayload ?? findReadyForPlannerPayload(pmSession);
  if (!payload && !directRequirement) {
    return redirect(request, projectPath(project.projectId, selectedWorkflow?.workflowId ?? null, `Enter a requirement or use PM chat to produce ready_for_planner JSON.`));
  }

  try {
    const requirement = payload ? formatPmHandoffPayload(payload) : directRequirement;
    const workflow = selectedWorkflow?.projectId === project.projectId
      ? await confirmWorkflowRequirement(selectedWorkflow, requirement, project)
      : await createWorkflow(requirement, 0, project);
    const job = await createJob({
      projectId: project.projectId,
      type: "workflow_run",
      payload: { workflowId: workflow.workflowId }
    });
    if (runPlanner) await runJobById(job.jobId, project.projectId);
    const next = new URL(`/projects/${project.projectId}`, request.url);
    next.searchParams.set("role", "product_manager");
    next.searchParams.set("phase", runPlanner ? "github" : "requirements");
    if (!runPlanner) next.searchParams.set("queued", "1");
    next.searchParams.set("workflow", workflow.workflowId);
    next.searchParams.set("job", job.jobId);
    return NextResponse.redirect(next, { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Planner handoff failed.";
    return redirect(request, projectPath(project.projectId, selectedWorkflow?.workflowId ?? null, message));
  }
}

function redirect(request: Request, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}

function projectPath(projectId: string, workflowId: string | null, error: string): string {
  const params = new URLSearchParams({
    role: "product_manager",
    phase: "requirements",
    error
  });
  if (workflowId) params.set("workflow", workflowId);
  return `/projects/${projectId}?${params.toString()}`;
}
