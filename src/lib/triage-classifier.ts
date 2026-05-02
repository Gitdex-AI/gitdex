import type { ProjectTriageGroup } from "@/lib/types";

export function classifyTriageIssue(input: {
  issueState: string;
  issueLabels: string[];
  primaryLinkedPrState: string | null;
  primaryLinkedPrLabels: string[];
}): ProjectTriageGroup {
  const labels = new Set([...input.issueLabels, ...input.primaryLinkedPrLabels].map((label) => label.toLowerCase()));
  if (hasAnyLabel(labels, ["taskix:blocked", "taskix:spec-blocked", "qa-failed", "taskix:qa-failed"])) return "blocked";
  if (input.issueState === "CLOSED" || input.primaryLinkedPrState === "MERGED" || hasAnyLabel(labels, ["taskix:merged"])) return "done";
  if (hasAnyLabel(labels, ["taskix:need-qa", "qa-running", "taskix:qa-running"])) return "needs_qa";
  if (hasAnyLabel(labels, ["taskix:ready-to-merge", "qa-passed", "taskix:qa-passed"])) return "ready_to_merge";
  if (hasAnyLabel(labels, ["taskix:dev-running", "taskix:pr-opened"]) || input.primaryLinkedPrState === "OPEN") return "in_progress";
  return "untracked";
}

function hasAnyLabel(labels: Set<string>, expected: string[]): boolean {
  return expected.some((label) => labels.has(label));
}
