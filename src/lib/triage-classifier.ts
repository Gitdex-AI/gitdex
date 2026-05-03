import type { ProjectTriageGroup } from "@/lib/types";

export function classifyTriageIssue(input: {
  issueState: string;
  issueLabels: string[];
  primaryLinkedPrState: string | null;
  primaryLinkedPrLabels: string[];
}): ProjectTriageGroup {
  const labels = new Set([...input.issueLabels, ...input.primaryLinkedPrLabels].map((label) => label.toLowerCase()));
  if (hasAnyLabel(labels, ["gd:blocked", "gd:architect", "taskix:blocked", "taskix:spec-blocked", "taskix:env-blocked", "qa-failed", "taskix:qa-failed"])) return "blocked";
  if (input.issueState === "CLOSED" || input.primaryLinkedPrState === "MERGED" || hasAnyLabel(labels, ["gd:done", "taskix:merged"])) return "done";
  if (hasAnyLabel(labels, ["gd:qa", "taskix:need-qa", "qa-running", "taskix:qa-running"])) return "needs_qa";
  if (hasAnyLabel(labels, ["gd:review", "gd:merge", "taskix:ready-to-merge", "qa-passed", "taskix:qa-passed"])) return "ready_to_merge";
  if (hasAnyLabel(labels, ["gd:dev", "gd:fix", "gd:rebase", "taskix:dev-running"]) || input.primaryLinkedPrState === "OPEN") return "in_progress";
  return "untracked";
}

function hasAnyLabel(labels: Set<string>, expected: string[]): boolean {
  return expected.some((label) => labels.has(label));
}
