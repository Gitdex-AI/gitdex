import { NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { archiveWorkflow, getProject, getWorkflow, listJobs } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; workflowId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, workflowId } = await params;
  const form = await request.formData();
  const [project, workflow, jobs] = await Promise.all([getProject(projectId), getWorkflow(workflowId), listJobs(projectId)]);
  if (!project) return redirect(request, `/?error=${encodeURIComponent("Project not found.")}`);
  const returnTo = safeProjectReturnPath(project.projectId, String(form.get("returnTo") ?? ""));
  if (!workflow || workflow.projectId !== project.projectId) {
    return redirect(request, withMessage(returnTo, "error", "Requirement not found."));
  }
  if (!workflow.trackingCode) {
    return redirect(request, withMessage(returnTo, "error", "Draft requirements must be discarded, not archived."));
  }
  if (workflow.archivedAt) {
    return redirect(request, withMessage(returnTo, "message", "Requirement is already archived."));
  }

  const activeJob = jobs.find((job) =>
    (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
  );
  if (activeJob) {
    return redirect(request, withMessage(returnTo, "error", "Stop or finish active jobs before archiving this requirement."));
  }

  await archiveWorkflow(workflow.workflowId);
  return redirect(request, withMessage(returnTo, "message", "Requirement archived."));
}

function redirect(request: Request, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}

function safeProjectReturnPath(projectId: string, value: string): string {
  return value.startsWith(`/projects/${projectId}`) ? value : `/projects/${projectId}`;
}

function withMessage(path: string, key: "message" | "error", value: string): string {
  const [pathname, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  params.set(key, value);
  return `${pathname}?${params.toString()}`;
}
