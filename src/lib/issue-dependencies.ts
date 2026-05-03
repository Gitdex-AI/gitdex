import type { IssueRecord } from "@/lib/types";

export function findDependencyIssue(dependency: string, issues: IssueRecord[]): IssueRecord | null {
  const normalized = normalizeReference(dependency);
  if (!normalized) return null;
  return issues.find((candidate) => (
    candidate.issueId.toLowerCase() === normalized
    || String(candidate.githubIssueNumber ?? "") === normalized
  )) ?? null;
}

export function isDependencySatisfied(issue: IssueRecord): boolean {
  const labels = [...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase());
  return issue.prState === "MERGED"
    || issue.githubState === "CLOSED"
    || labels.some((label) => label === "gitdex:merged" || label === "gitdex:deployed");
}

export function normalizeIssueDependenciesToNumbers(issues: IssueRecord[]): number {
  let changed = 0;
  for (const issue of issues) {
    const normalizedDependencies = (issue.dependsOn ?? []).map((dependency) => {
      const upstream = findDependencyByPlanningReference(dependency, issues);
      return upstream?.githubIssueNumber ? `#${upstream.githubIssueNumber}` : dependency;
    });
    if (JSON.stringify(issue.dependsOn ?? []) !== JSON.stringify(normalizedDependencies)) {
      issue.dependsOn = normalizedDependencies;
      changed += 1;
    }
  }
  return changed;
}

function findDependencyByPlanningReference(dependency: string, issues: IssueRecord[]): IssueRecord | null {
  const normalized = normalizeReference(dependency);
  const title = normalizeTitle(dependency);
  if (!normalized && !title) return null;
  return issues.find((candidate) => (
    candidate.issueId.toLowerCase() === normalized
    || String(candidate.githubIssueNumber ?? "") === normalized
    || normalizeTitle(candidate.title) === title
  )) ?? null;
}

function normalizeReference(value: string): string {
  return value.trim().toLowerCase().replace(/^#/, "");
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
