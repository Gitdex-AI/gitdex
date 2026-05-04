import { classifyTriageIssue } from "./triage-classifier";
import type { IssueRecord, ProjectTriageGroup, ProjectTriageItem, ProjectTriageResponse, WorkflowRecord } from "./types";

export const projectTriageGroups: ProjectTriageGroup[] = ["blocked", "needs_qa", "ready_to_merge", "in_progress", "done", "untracked"];

export function buildProjectTriageResponse(input: {
  projectId: string;
  repo: string;
  items: ProjectTriageItem[];
  generatedAt?: string;
  lastSyncedAt?: string | null;
}): ProjectTriageResponse {
  const groups = Object.fromEntries(projectTriageGroups.map((group) => [group, input.items.filter((item) => item.group === group)])) as ProjectTriageResponse["groups"];
  const counts = Object.fromEntries(projectTriageGroups.map((group) => [group, groups[group].length])) as ProjectTriageResponse["counts"];

  return {
    ok: true,
    projectId: input.projectId,
    repo: input.repo,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    lastSyncedAt: input.lastSyncedAt ?? null,
    counts,
    groups
  };
}

export function getProjectTriageFromWorkflows(input: {
  projectId: string;
  repo: string;
  workflows: WorkflowRecord[];
}): ProjectTriageResponse {
  const items = input.workflows.flatMap((workflow) => workflow.issues.map((issue) => triageItemFromIssue(issue)).filter((item): item is ProjectTriageItem => Boolean(item)));
  return buildProjectTriageResponse({
    projectId: input.projectId,
    repo: input.repo,
    items,
    lastSyncedAt: latestGitHubSyncAt(input.workflows)
  });
}

function triageItemFromIssue(issue: IssueRecord): ProjectTriageItem | null {
  if (!issue.githubIssueNumber || !issue.githubIssueUrl) return null;
  const issueLabels = issue.labels ?? [];
  const primaryLinkedPrLabels = issue.prLabels ?? [];
  const primaryLinkedPrState = issue.prState ?? null;

  return {
    issueNumber: issue.githubIssueNumber,
    issueUrl: issue.githubIssueUrl,
    issueState: issue.githubState ?? "OPEN",
    issueLabels,
    primaryLinkedPrUrl: issue.prUrl ?? null,
    primaryLinkedPrState,
    primaryLinkedPrLabels,
    group: classifyTriageIssue({
      issueState: issue.githubState ?? "OPEN",
      issueLabels,
      primaryLinkedPrState,
      primaryLinkedPrLabels
    })
  };
}

export function latestGitHubSyncAt(workflows: WorkflowRecord[]): string | null {
  const timestamps = workflows
    .flatMap((workflow) => workflow.timeline ?? [])
    .map((entry) => entry.match(/GitHub sync (?:checked|completed|ran|synced).*? at ([0-9T:.-]+Z)/i)?.[1] ?? entry.match(/Synced GitHub issue\/PR labels at ([0-9T:.-]+Z)/i)?.[1] ?? null)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}
