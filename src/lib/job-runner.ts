import { runWorkflow, runWorkflowIssue, runWorkflowQa, syncWorkflowFromGitHub } from "@/lib/orchestrator";
import { runWithJobRuntime } from "@/lib/job-runtime";
import { claimNextPendingJob, claimPendingJob, getJob, getProject, getWorkflow, saveJob } from "@/lib/store";
import type { JobRecord } from "@/lib/types";

export async function runNextJob(projectId?: string): Promise<{ job: JobRecord | null; ran: boolean }> {
  const job = await claimNextPendingJob(projectId);
  if (!job) return { job: null, ran: false };
  return runClaimedJob(job);
}

export async function runJobById(jobId: string, projectId?: string): Promise<{ job: JobRecord | null; ran: boolean }> {
  const job = await claimPendingJob(jobId, projectId);
  if (!job) return { job: await getJob(jobId), ran: false };
  return runClaimedJob(job);
}

async function runClaimedJob(job: JobRecord): Promise<{ job: JobRecord | null; ran: boolean }> {
  let skipped = false;

  try {
    await runWithJobRuntime(job.jobId, async () => {
      if (job.type !== "workflow_run" && job.type !== "issue_run" && job.type !== "qa_run") return;
      const project = job.projectId ? await getProject(job.projectId) : null;
      const workflow = await getWorkflow(job.payload.workflowId);
      if (workflow?.paused) {
        job.status = "pending";
        job.error = "Workflow is paused";
        job.updatedAt = new Date().toISOString();
        await saveJob(job);
        skipped = true;
        return;
      }
      if (job.type === "issue_run" && job.payload.issueId) {
        await runWorkflowIssue(job.payload.workflowId, job.payload.issueId, project);
      } else if (job.type === "qa_run" && job.payload.issueId) {
        await runWorkflowQa(job.payload.workflowId, job.payload.issueId, project, {
          prUrl: job.payload.prUrl ?? null,
          headSha: job.payload.headSha ?? null,
          qaAttempt: job.payload.qaAttempt ?? null
        });
      } else {
        await runWorkflow(job.payload.workflowId, project);
      }
      await syncWorkflowFromGitHub(job.payload.workflowId, project);
    });
    if (!skipped) {
      job.status = "done";
      job.error = null;
    }
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Unknown job failure";
  }

  const latestJob = await getJob(job.jobId);
  job.updatedAt = new Date().toISOString();
  job.runtime = { ...(job.runtime ?? {}), ...(latestJob?.runtime ?? {}), finishedAt: skipped ? latestJob?.runtime?.finishedAt ?? job.runtime?.finishedAt ?? null : job.updatedAt };
  await saveJob(job);
  return { job, ran: !skipped };
}
