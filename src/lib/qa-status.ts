import type { AgentSessionRecord, IssueRecord, WorkflowRecord } from "@/lib/types";

export type QaStatusId = "not_requested" | "needed" | "running" | "passed" | "failed" | "spec_blocked" | "env_blocked";

export type QaStatus = {
  id: QaStatusId;
  label: string;
  color: string;
};

const qaStatuses: Record<QaStatusId, QaStatus> = {
  not_requested: { id: "not_requested", label: "QA not requested", color: "gray" },
  needed: { id: "needed", label: "QA needed", color: "orange" },
  running: { id: "running", label: "QA running", color: "blue" },
  passed: { id: "passed", label: "QA passed", color: "green" },
  failed: { id: "failed", label: "QA failed", color: "red" },
  spec_blocked: { id: "spec_blocked", label: "Spec blocked", color: "red" },
  env_blocked: { id: "env_blocked", label: "Environment blocked", color: "red" }
};

export function getIssueQaStatus(issue: IssueRecord, qaSession?: AgentSessionRecord | null): QaStatus {
  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));

  if (labels.has("gd:architect")) return qaStatuses.spec_blocked;
  if (labels.has("gd:blocked")) return qaStatuses.env_blocked;
  if (labels.has("gd:fix")) return qaStatuses.failed;
  if (labels.has("gd:review") || labels.has("gd:merge") || labels.has("gd:done")) return qaStatuses.passed;
  if (labels.has("gd:qa")) return qaStatuses.needed;
  if (labels.has("gitdex:spec-blocked")) return qaStatuses.spec_blocked;
  if (labels.has("gitdex:env-blocked")) return qaStatuses.env_blocked;
  if (labels.has("gitdex:qa-failed") || labels.has("qa-failed")) return qaStatuses.failed;
  if (labels.has("gitdex:qa-passed") || labels.has("qa-passed")) return qaStatuses.passed;
  if (labels.has("gitdex:qa-running")) return qaStatuses.running;
  if (labels.has("gitdex:need-qa")) return qaStatuses.needed;
  if (qaSession?.status === "active" && !qaSession.archivedAt && !qaSession.closedAt) return qaStatuses.running;
  return qaStatuses.not_requested;
}

export function getWorkflowQaStatus(workflow: WorkflowRecord): QaStatus {
  if (!workflow.issues.length) return qaStatuses.not_requested;

  const issueStatuses = workflow.issues.map((issue) => getIssueQaStatus(issue).id);
  if (issueStatuses.includes("spec_blocked")) return qaStatuses.spec_blocked;
  if (issueStatuses.includes("env_blocked")) return qaStatuses.env_blocked;
  if (issueStatuses.includes("failed")) return qaStatuses.failed;
  if (issueStatuses.includes("running")) return qaStatuses.running;
  if (issueStatuses.includes("needed")) return qaStatuses.needed;
  if (issueStatuses.every((status) => status === "passed")) return qaStatuses.passed;
  if (issueStatuses.includes("passed")) return { id: "needed", label: "QA partial", color: "yellow" };
  return qaStatuses.not_requested;
}
