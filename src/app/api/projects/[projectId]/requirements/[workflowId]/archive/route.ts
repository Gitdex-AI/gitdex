import { NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { archiveWorkflow, getProject, getWorkflow, listJobs } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; workflowId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, workflowId } = await params;
  const [project, workflow, jobs] = await Promise.all([getProject(projectId), getWorkflow(workflowId), listJobs(projectId)]);
  if (!project) return redirect(request, `/projects?error=${encodeURIComponent("Project not found.")}`);
  if (!workflow || workflow.projectId !== project.projectId) {
    return redirect(request, `/projects/${project.projectId}?error=${encodeURIComponent("Requirement not found.")}`);
  }
  if (!workflow.trackingCode) {
    return redirect(request, `/projects/${project.projectId}?workflow=${encodeURIComponent(workflow.workflowId)}&error=${encodeURIComponent("Draft requirements must be discarded, not archived.")}`);
  }
  if (workflow.archivedAt) {
    return redirect(request, `/projects/${project.projectId}?message=${encodeURIComponent("Requirement is already archived.")}`);
  }

  const activeJob = jobs.find((job) =>
    (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
  );
  if (activeJob) {
    return redirect(request, `/projects/${project.projectId}?workflow=${encodeURIComponent(workflow.workflowId)}&error=${encodeURIComponent("Stop or finish active jobs before archiving this requirement.")}`);
  }

  await archiveWorkflow(workflow.workflowId);
  return redirect(request, `/projects/${project.projectId}?message=${encodeURIComponent("Requirement archived.")}`);
}

function redirect(request: Request, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}
