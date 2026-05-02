import { randomUUID } from "node:crypto";
import { getJsonValue, setJsonValue } from "@/lib/db";
import { listJobs, saveJob } from "@/lib/store";
import type { JobRecord } from "@/lib/types";

export type AutoRunStatus = "idle" | "running" | "pause_requested" | "paused" | "cancel_requested" | "cancelled" | "completed" | "failed";

export type AutoRunState = {
  runId: string;
  projectId: string;
  status: AutoRunStatus;
  workflowIds: string[];
  issueIds: string[];
  message: string;
  createdAt: string;
  updatedAt: string;
};

const runnableJobTypes = new Set<JobRecord["type"]>(["architect_blocker_run", "issue_run", "qa_run", "architect_review_run", "merge_run"]);

export function autoRunStateKey(projectId: string): string {
  return `project:${projectId}:issue_auto_run`;
}

export function getAutoRunState(projectId: string): AutoRunState | null {
  return getJsonValue<AutoRunState>(autoRunStateKey(projectId));
}

export function startAutoRunState(projectId: string, input: { workflowIds: string[]; issueIds: string[] }): AutoRunState {
  const now = new Date().toISOString();
  const state: AutoRunState = {
    runId: randomUUID().slice(0, 12),
    projectId,
    status: "running",
    workflowIds: input.workflowIds,
    issueIds: input.issueIds,
    message: "Auto Run is running.",
    createdAt: now,
    updatedAt: now
  };
  setJsonValue(autoRunStateKey(projectId), state);
  return state;
}

export function updateAutoRunState(projectId: string, update: Partial<Omit<AutoRunState, "projectId" | "createdAt">>): AutoRunState {
  const existing = getAutoRunState(projectId);
  const now = new Date().toISOString();
  const state: AutoRunState = {
    runId: update.runId ?? existing?.runId ?? randomUUID().slice(0, 12),
    projectId,
    status: update.status ?? existing?.status ?? "idle",
    workflowIds: update.workflowIds ?? existing?.workflowIds ?? [],
    issueIds: update.issueIds ?? existing?.issueIds ?? [],
    message: update.message ?? existing?.message ?? "Auto Run is idle.",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  setJsonValue(autoRunStateKey(projectId), state);
  return state;
}

export function shouldPauseAutoRun(projectId: string, runId: string): boolean {
  const state = getAutoRunState(projectId);
  return state?.runId === runId && state.status === "pause_requested";
}

export function shouldCancelAutoRun(projectId: string, runId: string): boolean {
  const state = getAutoRunState(projectId);
  return state?.runId === runId && state.status === "cancel_requested";
}

export async function cancelAutoRunJobs(projectId: string, reason: string): Promise<number> {
  const state = getAutoRunState(projectId);
  const issueScope = new Set(state?.issueIds ?? []);
  const jobs = await listJobs(projectId);
  let cancelled = 0;

  for (const job of jobs) {
    if (job.status !== "running") continue;
    if (!runnableJobTypes.has(job.type)) continue;
    if (issueScope.size && (!job.payload.issueId || !issueScope.has(job.payload.issueId))) continue;
    if (job.runtime?.pid) {
      try {
        process.kill(job.runtime.pid);
      } catch {
        // The process may already have exited.
      }
    }
    job.status = "cancelled";
    job.error = reason;
    job.updatedAt = new Date().toISOString();
    job.runtime = { ...(job.runtime ?? {}), finishedAt: job.updatedAt };
    await saveJob(job);
    cancelled += 1;
  }

  return cancelled;
}
