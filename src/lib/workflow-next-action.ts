import type { JobRecord } from "@/lib/types";

export type WorkflowNextActionTone = "ready" | "running" | "blocked" | "idle";
export type WorkflowNextActionIcon = "clock" | "play" | "git-branch" | "alert" | "check";

export type WorkflowNextAction = {
  title: string;
  phase: string;
  description: string;
  buttonLabel: string | null;
  disabledLabel: string;
  tone: WorkflowNextActionTone;
  icon: WorkflowNextActionIcon;
  planningPending: number;
  developerPending: number;
  runningCount: number;
  failedCount: number;
};

export function getWorkflowNextAction(jobs: Pick<JobRecord, "status" | "type">[]): WorkflowNextAction {
  const planningPending = jobs.filter((job) => job.status === "pending" && job.type === "workflow_run").length;
  const developerPending = jobs.filter((job) => job.status === "pending" && job.type === "issue_run").length;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;

  if (runningCount) {
    return {
      title: "Workflow step running",
      phase: "Running",
      description: "Taskix is executing the current job. Refresh or wait for the session and job status to update before starting another step.",
      buttonLabel: null,
      disabledLabel: "Running",
      tone: "running",
      icon: "clock",
      planningPending,
      developerPending,
      runningCount,
      failedCount
    };
  }

  if (developerPending) {
    return {
      title: "Start next developer issue",
      phase: "Developer work",
      description: "Runs one planned developer issue. The developer should create a branch and pull request, then stop for QA and merge readiness.",
      buttonLabel: "Start Next Developer Issue",
      disabledLabel: "Start Next Developer Issue",
      tone: "ready",
      icon: "play",
      planningPending,
      developerPending,
      runningCount,
      failedCount
    };
  }

  if (planningPending) {
    return {
      title: "Run architect planning",
      phase: "Planning",
      description: "The architect will split the requirement into GitHub issues. Developer work will not start until you run the next step.",
      buttonLabel: "Run Architect Planning",
      disabledLabel: "Run Architect Planning",
      tone: "ready",
      icon: "git-branch",
      planningPending,
      developerPending,
      runningCount,
      failedCount
    };
  }

  if (failedCount) {
    return {
      title: "Blocked job needs attention",
      phase: "Blocked",
      description: "A previous job failed or timed out. Inspect the session, fix the blocker, then retry from the workflow or session controls.",
      buttonLabel: null,
      disabledLabel: "Blocked",
      tone: "blocked",
      icon: "alert",
      planningPending,
      developerPending,
      runningCount,
      failedCount
    };
  }

  return {
    title: "No pending work",
    phase: "Idle",
    description: "Queue a requirement to start planning, or review existing workflows and PRs before taking another manual step.",
    buttonLabel: null,
    disabledLabel: "No Pending Work",
    tone: "idle",
    icon: "check",
    planningPending,
    developerPending,
    runningCount,
    failedCount
  };
}
