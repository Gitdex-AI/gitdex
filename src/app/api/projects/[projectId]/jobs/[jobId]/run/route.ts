import { NextResponse } from "next/server";
import { runJobById } from "@/lib/job-runner";
import { getProject } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(_request: Request, context: { params: Promise<{ projectId: string; jobId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, jobId } = await context.params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const result = await runJobById(jobId, project.projectId);
  if (!result.job || result.job.projectId !== project.projectId) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (!result.ran) return NextResponse.json({ error: `Job is ${result.job.status}, not pending.` }, { status: 409 });
  return NextResponse.json(result);
}
