import type { IssueRecord } from "./types.ts";

export function canAutoRunDeveloper(issue: IssueRecord): boolean {
  return !isClosedIssue(issue)
    && !issue.prUrl
    && issue.prState !== "MERGED"
    && !hasAnyIssueLabel(issue, ["taskix:dev-running", "taskix:blocked", "taskix:spec-blocked", "taskix:env-blocked", "taskix:need-qa", "taskix:qa-running", "taskix:qa-passed", "taskix:ready-to-merge", "taskix:merged"]);
}

export function canAutoRunQa(issue: IssueRecord): boolean {
  return Boolean(issue.prUrl)
    && !isClosedIssue(issue)
    && issue.prState !== "MERGED"
    && !hasAnyIssueLabel(issue, ["taskix:qa-running", "qa-passed", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:spec-blocked", "taskix:env-blocked", "taskix:ready-to-merge", "taskix:merged"]);
}

export function isClosedIssue(issue: IssueRecord): boolean {
  return issue.githubState === "CLOSED" || issue.prState === "CLOSED" || issue.prState === "MERGED";
}

function hasAnyIssueLabel(issue: IssueRecord, labels: string[]): boolean {
  const lowerLabels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  return labels.some((label) => lowerLabels.has(label.toLowerCase()));
}
