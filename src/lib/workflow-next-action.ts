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
  qaPending: number;
  runningCount: number;
  failedCount: number;
};

export function getWorkflowNextAction(jobs: Pick<JobRecord, "status" | "type">[]): WorkflowNextAction {
  const planningPending = jobs.filter((job) => job.status === "pending" && job.type === "workflow_run").length;
  const developerPending = jobs.filter((job) => job.status === "pending" && job.type === "issue_run").length;
  const qaPending = jobs.filter((job) => job.status === "pending" && job.type === "qa_run").length;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;

  if (runningCount) {
    return {
      title: "Workflow step running",
      phase: "Running",
      description: "Gitdex is executing the current job. Refresh or wait for the session and job status to update before starting another step.",
      buttonLabel: null,
      disabledLabel: "Running",
      tone: "running",
      icon: "clock",
      planningPending,
      developerPending,
      qaPending,
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
      qaPending,
      runningCount,
      failedCount
    };
  }

  if (qaPending) {
    return {
      title: "Start next QA validation",
      phase: "QA validation",
      description: "Runs one QA validation job for a developer PR and records pass/fail before review and merge handling.",
      buttonLabel: "Start Next QA Validation",
      disabledLabel: "Start Next QA Validation",
      tone: "ready",
      icon: "play",
      planningPending,
      developerPending,
      qaPending,
      runningCount,
      failedCount
    };
  }

  if (planningPending) {
    return {
      title: "Run planner",
      phase: "Planning",
      description: "The planner will split the requirement into GitHub issues. Developer work will not start until you run the next step.",
      buttonLabel: "Run Planner",
      disabledLabel: "Run Planner",
      tone: "ready",
      icon: "git-branch",
      planningPending,
      developerPending,
      qaPending,
      runningCount,
      failedCount
    };
  }

  if (failedCount) {
    return {
      title: "Resolve blocker before continuing",
      phase: "Blocked",
      description: "Open the related step details, inspect the failed session, fix the blocker, then retry from the workflow or session controls.",
      buttonLabel: null,
      disabledLabel: "Blocked",
      tone: "blocked",
      icon: "alert",
      planningPending,
      developerPending,
      qaPending,
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
    qaPending,
    runningCount,
    failedCount
  };
}
