import type { AgentSessionRecord, IssueRecord, JobRecord, WorkflowRecord } from "@/lib/types";

type RecoveryIssue = Pick<IssueRecord, "branch" | "labels" | "prLabels" | "prState" | "prUrl">;
type RecoveryWorkflow = Pick<WorkflowRecord, "issues">;
type RecoveryJob = Pick<JobRecord, "status">;
type RecoveryJobWithType = Pick<JobRecord, "status" | "type">;
type RecoverySession = Pick<AgentSessionRecord, "status">;

export function recoveryReasonForJobs(jobs: RecoveryJob[]): string | null {
  if (jobs.some((job) => job.status === "failed")) return "A planning job failed. Retry the failed job, or sync GitHub if issues were created before the failure.";
  if (jobs.some((job) => job.status === "running")) return "Planning is running. If the status does not change after several minutes, sync state or retry after it is marked failed.";
  return null;
}

export function recoveryReasonForDeveloperStep(
  workflows: RecoveryWorkflow[],
  jobs: RecoveryJobWithType[],
  sessions: RecoverySession[]
): string | null {
  if (jobs.some((job) => job.status === "failed")) return "A developer job failed. Retry the failed job; if a branch or PR was already created, recover it from GitHub first.";
  if (sessions.some((session) => session.status === "blocked")) return "A developer session is blocked. Open the session for the blocker details, then retry or recover the PR from GitHub.";
  const issues = workflows.flatMap((workflow) => workflow.issues);
  if (issues.some((issue) => issue.branch && !issue.prUrl)) return "Developer work has a branch but no recorded PR. Use GitHub sync to recover a PR that was created or finish PR creation manually.";
  if (issues.some((issue) => hasAnyLabel(issue, ["taskix:dev-running"]) && !issue.prUrl)) return "Developer work is marked running without a PR. Sync GitHub to detect a partially completed PR, or retry the developer job.";
  return null;
}

export function recoveryReasonForQaStep(workflows: RecoveryWorkflow[], sessions: RecoverySession[]): string | null {
  if (sessions.some((session) => session.status === "blocked")) return "QA is blocked or failed. Open the QA session for findings, then retry the developer fix path after the issue is updated.";
  const issues = workflows.flatMap((workflow) => workflow.issues);
  if (issues.some((issue) => (issue.prUrl || issue.prState?.toUpperCase() === "OPEN") && !hasAnyLabel(issue, ["taskix:need-qa", "taskix:qa-running", "qa-passed", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:ready-to-merge"]))) {
    return "A PR is open but QA labels are missing. Sync GitHub to recover labels, or request QA before this workflow can move forward.";
  }
  if (issues.some((issue) => issue.prUrl && hasAnyLabel(issue, ["taskix:need-qa", "taskix:qa-running"]))) {
    return "A PR is waiting on QA labels. After QA finishes, sync GitHub so Taskix can move the workflow to pass/fail or merge readiness.";
  }
  return null;
}

export function recoveryReasonForMergeStep(workflows: RecoveryWorkflow[]): string | null {
  const issues = workflows.flatMap((workflow) => workflow.issues);
  if (issues.some((issue) => hasAnyLabel(issue, ["qa-passed", "taskix:qa-passed", "taskix:ready-to-merge"]) && issue.prState !== "MERGED")) {
    return "QA has passed and the PR is ready. Merge from this step, then sync GitHub if the issue or PR state does not update.";
  }
  return null;
}

export function hasAnyLabel(issue: RecoveryIssue, expected: string[]): boolean {
  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  return expected.some((label) => labels.has(label));
}
