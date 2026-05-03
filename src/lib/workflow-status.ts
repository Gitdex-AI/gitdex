import type { WorkflowRecord } from "@/lib/types";

const blockedLabels = ["gd:blocked", "gd:architect", "gitdex:blocked", "gitdex:qa-failed", "gitdex:spec-blocked", "gitdex:env-blocked"];
const doneLabels = ["gd:done", "gitdex:merged", "gitdex:deployed"];
const progressLabels = ["gd:dev", "gd:fix", "gd:rebase", "gd:qa", "gd:review", "gd:merge", "gitdex:dev-running", "gitdex:architect-review", "gitdex:need-qa", "gitdex:qa-running", "gitdex:qa-passed", "gitdex:ready-to-merge"];

export function deriveWorkflowStatus(workflow: WorkflowRecord): WorkflowRecord["status"] {
  if (!workflow.issues.length) return workflow.status;
  const issues = workflow.issues;
  const hasBlocked = issues.some((issue) => includesAny(issueLabels(issue), blockedLabels));
  if (hasBlocked) return "blocked";
  const allDone = issues.every((issue) => isTerminalIssue(issue));
  if (allDone) return "done";
  const anyProgress = issues.some((issue) => Boolean(issue.prUrl) || issue.prState === "OPEN" || includesAny(issueLabels(issue), progressLabels));
  return anyProgress ? "in_progress" : workflow.status;
}

function isTerminalIssue(issue: WorkflowRecord["issues"][number]): boolean {
  const labels = issueLabels(issue);
  return includesAny(labels, doneLabels)
    || issue.githubState === "CLOSED"
    || issue.prState === "CLOSED"
    || issue.prState === "MERGED";
}

function issueLabels(issue: WorkflowRecord["issues"][number]): string[] {
  return [...(issue.labels ?? []), ...(issue.prLabels ?? [])];
}

function includesAny(values: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => values.includes(candidate));
}
