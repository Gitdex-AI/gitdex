import type { ProjectTriageGroup } from "@/lib/types";

export function classifyTriageIssue(input: {
  issueState: string;
  issueLabels: string[];
  primaryLinkedPrState: string | null;
  primaryLinkedPrLabels: string[];
}): ProjectTriageGroup {
  const labels = new Set([...input.issueLabels, ...input.primaryLinkedPrLabels].map((label) => label.toLowerCase()));
  if (hasAnyLabel(labels, ["gd:blocked", "gd:architect", "gitdex:blocked", "gitdex:spec-blocked", "gitdex:env-blocked", "qa-failed", "gitdex:qa-failed"])) return "blocked";
  if (input.issueState === "CLOSED" || input.primaryLinkedPrState === "MERGED" || hasAnyLabel(labels, ["gd:done", "gitdex:merged"])) return "done";
  if (hasAnyLabel(labels, ["gd:qa", "gitdex:need-qa", "qa-running", "gitdex:qa-running"])) return "needs_qa";
  if (hasAnyLabel(labels, ["gd:review", "gd:merge", "gitdex:ready-to-merge", "qa-passed", "gitdex:qa-passed"])) return "ready_to_merge";
  if (hasAnyLabel(labels, ["gd:dev", "gd:fix", "gd:rebase", "gitdex:dev-running"]) || input.primaryLinkedPrState === "OPEN") return "in_progress";
  return "untracked";
}

function hasAnyLabel(labels: Set<string>, expected: string[]): boolean {
  return expected.some((label) => labels.has(label));
}
