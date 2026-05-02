import { NextResponse } from "next/server";
import { createJob, getJob, getProject, getWorkflow, saveJob, saveWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(_request: Request, context: { params: Promise<unknown> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, jobId } = await context.params as { projectId: string; jobId: string };
  const [project, job] = await Promise.all([getProject(projectId), getJob(jobId)]);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!job || job.projectId !== project.projectId) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "failed" && job.status !== "running") return NextResponse.json({ error: "Only failed or running jobs can be recovered." }, { status: 409 });

  const now = new Date().toISOString();
  const wasRunning = job.status === "running";
  job.status = "failed";
  job.error = wasRunning
    ? "Recovered by user: running job was treated as stalled and a replacement job was queued."
    : job.error ? `Retry queued after failure: ${job.error}` : "Retry queued after stalled job.";
  job.updatedAt = now;
  job.runtime = { ...(job.runtime ?? {}), finishedAt: job.runtime?.finishedAt ?? now };
  await saveJob(job);

  const retryJob = await createJob({
    projectId: project.projectId,
    type: job.type,
    payload: job.payload
  });

  const workflow = await getWorkflow(job.payload.workflowId);
  if (workflow) {
    workflow.status = "in_progress";
    workflow.timeline.push(wasRunning ? `Recovered stalled ${job.type} job ${job.jobId} and queued a replacement.` : `Retry queued for ${job.type} job ${job.jobId}.`);
    await saveWorkflow(workflow);
  }

  return NextResponse.json({ ok: true, jobId: retryJob.jobId, runStatus: retryJob.status });
}
