import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expectedDeveloperBaseBranch } from "@/lib/issue-run-policy";
import { dataDir } from "@/lib/paths";
import { listJobs, listWorkflows } from "@/lib/store";
import type { IssueRecord, WorkflowRecord } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type WorktreeRebuildResult = {
  rebuilt: boolean;
  workspaceDir: string;
  archivedDir: string | null;
  error: string | null;
};

export type WorktreeCleanupResult = {
  retentionDays: number;
  removed: string[];
  skipped: string[];
  errors: Array<{ path: string; error: string }>;
};

export function developerWorktreeDir(workflowCode: string, issueNumberOrId: number | string): string {
  return path.join(workspaceRoot(), sanitizePathSegment(`${workflowCode}-issue-${issueNumberOrId}`));
}

export async function rebuildDeveloperWorktree(input: {
  repo: string;
  workflowCode: string;
  issueNumberOrId: number | string;
  branch: string;
  baseBranch?: string | null;
}): Promise<WorktreeRebuildResult> {
  const workspaceDir = developerWorktreeDir(input.workflowCode, input.issueNumberOrId);
  const archivedDir = await archiveWorkspaceIfPresent(workspaceDir);
  try {
    await mkdir(path.dirname(workspaceDir), { recursive: true });
    await execFileAsync("gh", ["repo", "clone", input.repo, workspaceDir]);
    const baseBranch = input.baseBranch || expectedDeveloperBaseBranch();
    await execFileAsync("git", ["-C", workspaceDir, "fetch", "origin", "--prune"]);
    await execFileAsync("git", ["-C", workspaceDir, "checkout", "-B", input.branch, `origin/${baseBranch}`]);
    return { rebuilt: true, workspaceDir, archivedDir, error: null };
  } catch (error) {
    return {
      rebuilt: false,
      workspaceDir,
      archivedDir,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function cleanupInactiveWorktrees(retentionDays: number): Promise<WorktreeCleanupResult> {
  const root = workspaceRoot();
  const result: WorktreeCleanupResult = { retentionDays, removed: [], skipped: [], errors: [] };
  if (!existsSync(root)) return result;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const [workflows, jobs, entries] = await Promise.all([listWorkflows(), listJobs(), readdir(root, { withFileTypes: true })]);
  const completedNames = completedWorktreeNames(workflows);
  const runningIssueIds = new Set(jobs.filter((job) => job.status === "running" || job.status === "pending").map((job) => job.payload.issueId).filter((issueId): issueId is string => Boolean(issueId)));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(root, entry.name);
    const info = await stat(fullPath).catch(() => null);
    if (!info || info.mtimeMs >= cutoff) {
      result.skipped.push(entry.name);
      continue;
    }
    if (!isCleanableWorktree(entry.name, completedNames, workflows, runningIssueIds)) {
      result.skipped.push(entry.name);
      continue;
    }
    try {
      await rm(fullPath, { recursive: true, force: true });
      result.removed.push(entry.name);
    } catch (error) {
      result.errors.push({ path: entry.name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

function workspaceRoot(): string {
  return path.join(dataDir, "taskix-workspaces");
}

async function archiveWorkspaceIfPresent(workspaceDir: string): Promise<string | null> {
  if (!existsSync(workspaceDir)) return null;
  const archivedDir = `${workspaceDir}.bak-${timestampSegment()}`;
  await rename(workspaceDir, archivedDir);
  return archivedDir;
}

function completedWorktreeNames(workflows: WorkflowRecord[]): Set<string> {
  const names = new Set<string>();
  for (const workflow of workflows) {
    const workflowCode = workflow.trackingCode ?? workflow.workflowId;
    for (const issue of workflow.issues) {
      if (!isCompletedIssue(issue)) continue;
      const issueNumberOrId = issue.githubIssueNumber ?? issue.issueId;
      names.add(sanitizePathSegment(`${workflowCode}-issue-${issueNumberOrId}`));
      if (issue.githubIssueNumber) {
        names.add(sanitizePathSegment(`qa-issue-${issue.githubIssueNumber}`));
        names.add(sanitizePathSegment(`architect-review-issue-${issue.githubIssueNumber}`));
      }
    }
  }
  return names;
}

function isCleanableWorktree(name: string, completedNames: Set<string>, workflows: WorkflowRecord[], runningIssueIds: Set<string>): boolean {
  if (name.includes(".bak-")) return true;
  if (completedNames.has(name)) return !isRunningIssueWorktree(name, workflows, runningIssueIds);
  return false;
}

function isRunningIssueWorktree(name: string, workflows: WorkflowRecord[], runningIssueIds: Set<string>): boolean {
  if (!runningIssueIds.size) return false;
  for (const workflow of workflows) {
    const workflowCode = workflow.trackingCode ?? workflow.workflowId;
    for (const issue of workflow.issues) {
      if (!runningIssueIds.has(issue.issueId)) continue;
      const issueNumberOrId = issue.githubIssueNumber ?? issue.issueId;
      if (name === sanitizePathSegment(`${workflowCode}-issue-${issueNumberOrId}`)) return true;
      if (issue.githubIssueNumber && (name === sanitizePathSegment(`qa-issue-${issue.githubIssueNumber}`) || name === sanitizePathSegment(`architect-review-issue-${issue.githubIssueNumber}`))) return true;
    }
  }
  return false;
}

function isCompletedIssue(issue: IssueRecord): boolean {
  const labels = [...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase());
  return issue.githubState === "CLOSED" || issue.prState === "MERGED" || labels.includes("taskix:merged") || labels.includes("taskix:deployed");
}

function sanitizePathSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

function timestampSegment(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
