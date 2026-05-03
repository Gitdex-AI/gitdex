import type { IssueRecord, JobRecord, WorkflowRecord } from "@/lib/types";

export type WorkflowProgressStepId = "requirement" | "planning" | "developer" | "qa" | "merge" | "done";
export type WorkflowProgressStepStatus = "complete" | "current" | "running" | "blocked" | "upcoming";

export type WorkflowProgressStep = {
  id: WorkflowProgressStepId;
  label: string;
  detail: string;
  status: WorkflowProgressStepStatus;
};

const stepOrder: WorkflowProgressStepId[] = ["requirement", "planning", "developer", "qa", "merge", "done"];

const stepCopy: Record<WorkflowProgressStepId, { label: string; detail: string }> = {
  requirement: {
    label: "1. PM requirement",
    detail: "Capture the request in chat, then queue it for planner issue breakdown."
  },
  planning: {
    label: "2. Planner",
    detail: "Split the request into GitHub issues and developer-owned work."
  },
  developer: {
    label: "3. Developer PR",
    detail: "Run one planned developer issue and create a pull request."
  },
  qa: {
    label: "4. QA validation",
    detail: "Run automated tests first, then verify the targeted browser flow."
  },
  merge: {
    label: "5. Review / merge",
    detail: "Reviewer checks code after QA passes, then handles merge readiness."
  },
  done: {
    label: "6. Done",
    detail: "The workflow is complete or there is no active work left."
  }
};

export function getWorkflowProgress(input: {
  workflows: Pick<WorkflowRecord, "status" | "issues">[];
  jobs: WorkflowProgressJob[];
}): WorkflowProgressStep[] {
  const workflows = input.workflows;
  const issues = workflows.flatMap((workflow) => workflow.issues);
  const jobs = input.jobs.filter((job) => isJobStillRelevant(job, issues));
  const hasAnyWorkflow = workflows.length > 0;
  const hasActiveWorkflow = workflows.some((workflow) => workflow.status !== "done");
  const hasDoneWorkflow = workflows.some((workflow) => workflow.status === "done");
  const blockedStep = getBlockedStep(workflows, jobs, issues);
  const runningStep = blockedStep ? null : getRunningStep(jobs);
  const currentStep = blockedStep ?? runningStep ?? getCurrentStep({ hasAnyWorkflow, hasActiveWorkflow, hasDoneWorkflow, issues, jobs });
  const currentIndex = stepOrder.indexOf(currentStep);

  return stepOrder.map((id, index) => ({
    id,
    label: stepCopy[id].label,
    detail: stepCopy[id].detail,
    status: getStepStatus({ id, index, currentIndex, blockedStep, runningStep, currentStep, hasDoneWorkflow, hasActiveWorkflow })
  }));
}

function getStepStatus(input: {
  id: WorkflowProgressStepId;
  index: number;
  currentIndex: number;
  blockedStep: WorkflowProgressStepId | null;
  runningStep: WorkflowProgressStepId | null;
  currentStep: WorkflowProgressStepId;
  hasDoneWorkflow: boolean;
  hasActiveWorkflow: boolean;
}): WorkflowProgressStepStatus {
  if (input.blockedStep === input.id) return "blocked";
  if (input.runningStep === input.id) return "running";
  if (input.index < input.currentIndex || isDoneComplete(input.id, input.hasDoneWorkflow, input.hasActiveWorkflow)) return "complete";
  if (input.id === input.currentStep) return "current";
  return "upcoming";
}

function getBlockedStep(
  workflows: Pick<WorkflowRecord, "status">[],
  jobs: WorkflowProgressJob[],
  issues: Pick<IssueRecord, "labels" | "prLabels" | "prUrl" | "prState">[]
): WorkflowProgressStepId | null {
  if (jobs.some((job) => job.status === "failed" && job.type === "workflow_run")) return "planning";
  if (jobs.some((job) => job.status === "failed" && job.type === "issue_run")) return "developer";
  if (issues.some((issue) => hasAnyIssueLabel(issue, ["gd:fix", "gd:blocked", "qa-failed", "taskix:qa-failed", "taskix:env-blocked"]))) return "qa";
  if (jobs.some((job) => job.status === "failed" && job.type === "qa_run")) return "qa";
  const blockedIssue = issues.find((issue) => hasAnyIssueLabel(issue, ["gd:architect", "taskix:blocked"]));
  if (blockedIssue) return blockedIssue.prUrl || blockedIssue.prState ? "qa" : "developer";
  if (workflows.some((workflow) => workflow.status === "blocked")) return "developer";
  return null;
}

function getRunningStep(jobs: WorkflowProgressJob[]): WorkflowProgressStepId | null {
  if (jobs.some((job) => job.status === "running" && job.type === "workflow_run")) return "planning";
  if (jobs.some((job) => job.status === "running" && job.type === "issue_run")) return "developer";
  if (jobs.some((job) => job.status === "running" && job.type === "qa_run")) return "qa";
  return null;
}

function getCurrentStep(input: {
  hasAnyWorkflow: boolean;
  hasActiveWorkflow: boolean;
  hasDoneWorkflow: boolean;
  issues: Pick<IssueRecord, "labels" | "prLabels" | "prUrl" | "prState">[];
  jobs: Pick<JobRecord, "status" | "type">[];
}): WorkflowProgressStepId {
  if (!input.hasAnyWorkflow && !input.jobs.length) return "requirement";
  if (!input.hasActiveWorkflow && input.hasDoneWorkflow) return "done";
  if (input.jobs.some((job) => job.status !== "done" && job.type === "workflow_run")) return "planning";
  if (input.jobs.some((job) => job.status !== "done" && job.type === "issue_run")) return "developer";
  if (input.jobs.some((job) => job.status !== "done" && job.type === "qa_run")) return "qa";
  if (input.issues.some((issue) => hasAnyIssueLabel(issue, ["gd:merge"]))) return "merge";
  if (input.issues.some((issue) => hasAnyIssueLabel(issue, ["gd:review", "qa-passed", "taskix:qa-passed"]))) return "merge";
  if (input.issues.some((issue) => issue.prUrl || issue.prState)) return "qa";
  if (input.issues.length) return "developer";
  if (input.hasActiveWorkflow) return "planning";
  return "requirement";
}

function isDoneComplete(id: WorkflowProgressStepId, hasDoneWorkflow: boolean, hasActiveWorkflow: boolean): boolean {
  return id === "done" && hasDoneWorkflow && !hasActiveWorkflow;
}

type WorkflowProgressJob = Pick<JobRecord, "status" | "type"> & {
  payload?: Pick<JobRecord["payload"], "issueId">;
};

function isJobStillRelevant(
  job: WorkflowProgressJob,
  issues: Pick<IssueRecord, "issueId" | "labels" | "prLabels" | "prUrl" | "prState">[]
): boolean {
  if (job.type !== "issue_run" || job.status !== "failed" || !job.payload?.issueId) return true;
  const issue = issues.find((item) => item.issueId === job.payload?.issueId);
  if (!issue) return true;
  return !isIssuePastDeveloperStep(issue);
}

function isIssuePastDeveloperStep(issue: Pick<IssueRecord, "labels" | "prLabels" | "prUrl" | "prState">): boolean {
  return Boolean(
    issue.prUrl ||
    issue.prState ||
    hasAnyIssueLabel(issue, ["gd:qa", "gd:review", "gd:merge", "taskix:need-qa", "taskix:qa-running", "qa-passed", "taskix:qa-passed", "taskix:ready-to-merge"])
  );
}

function hasAnyIssueLabel(issue: Pick<IssueRecord, "labels" | "prLabels">, expected: string[]): boolean {
  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  return expected.some((label) => labels.has(label));
}
