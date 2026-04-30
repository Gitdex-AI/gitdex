import type { AgentSessionRecord, IssueRecord, WorkflowRecord } from "@/lib/types";

export type QaStatusId = "not_requested" | "needed" | "running" | "passed" | "failed";

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
  failed: { id: "failed", label: "QA failed", color: "red" }
};

export function getIssueQaStatus(issue: IssueRecord, qaSession?: AgentSessionRecord | null): QaStatus {
  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? []), ...(qaSession?.labels ?? [])]);

  if (labels.has("taskix:qa-failed") || qaSession?.status === "blocked") return qaStatuses.failed;
  if (labels.has("taskix:qa-passed") || qaSession?.status === "done") return qaStatuses.passed;
  if (labels.has("taskix:qa-running") || qaSession?.status === "active") return qaStatuses.running;
  if (labels.has("taskix:need-qa") || qaSession?.role === "qa") return qaStatuses.needed;
  return qaStatuses.not_requested;
}

export function getWorkflowQaStatus(workflow: WorkflowRecord): QaStatus {
  if (!workflow.issues.length) return qaStatuses.not_requested;

  const issueStatuses = workflow.issues.map((issue) => getIssueQaStatus(issue).id);
  if (issueStatuses.includes("failed")) return qaStatuses.failed;
  if (issueStatuses.includes("running")) return qaStatuses.running;
  if (issueStatuses.includes("needed")) return qaStatuses.needed;
  if (issueStatuses.every((status) => status === "passed")) return qaStatuses.passed;
  if (issueStatuses.includes("passed")) return { id: "needed", label: "QA partial", color: "yellow" };
  return qaStatuses.not_requested;
}
