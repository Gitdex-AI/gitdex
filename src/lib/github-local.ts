import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { allTaskixLabels, roleLabel } from "@/lib/github-labels";
import { dataDir } from "@/lib/paths";
import { classifyTriageIssue } from "@/lib/triage-classifier";
import type { IssueSpec, ProjectTriageItem } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type LocalGitHubRepo = {
  nameWithOwner: string;
  sshUrl: string;
  url: string;
  isPrivate: boolean;
};

export type GhIssueSnapshot = {
  number: number;
  url: string;
  state: string;
  labels: string[];
  linkedPrs: Array<{
    number: number;
    url: string;
    state: string;
    labels: string[];
  }>;
};

type GhTriageIssue = {
  number: number;
  url: string;
  state: string;
  labels: Array<{ name: string }>;
};

type GhTriagePr = {
  number: number;
  url: string;
  state: string;
  labels: Array<{ name: string }>;
  mergeStateStatus?: string | null;
  closingIssuesReferences?: Array<{ number: number }>;
};

export async function listLocalGitHubRepos(owner: string): Promise<LocalGitHubRepo[]> {
  const { stdout } = await execFileAsync("gh", ["repo", "list", owner, "--limit", "100", "--json", "nameWithOwner,sshUrl,url,isPrivate"]);
  return JSON.parse(stdout) as LocalGitHubRepo[];
}

export async function verifyLocalGitHubRepo(repo: string): Promise<void> {
  await execFileAsync("gh", ["api", `repos/${repo}`, "--jq", ".full_name"]);
}

export async function getProjectTriageWithGh(repo: string): Promise<ProjectTriageItem[]> {
  const { stdout } = await execFileAsync("gh", [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--limit",
    "100",
    "--json",
    "number,url,state,labels"
  ]);
  const issues = JSON.parse(stdout) as GhTriageIssue[];
  return Promise.all(issues.map((issue) => getTriageItemWithGh(repo, issue)));
}

async function getTriageItemWithGh(repo: string, issue: GhTriageIssue): Promise<ProjectTriageItem> {
  const prs = await listLinkedPullRequestsWithGh(repo, issue.number);
  const primaryPr = pickPrimaryPullRequest(prs);
  const issueLabels = issue.labels.map((label) => label.name);
  const primaryLinkedPrLabels = primaryPr?.labels.map((label) => label.name) ?? [];
  const group = classifyTriageIssue({
    issueState: issue.state,
    issueLabels,
    primaryLinkedPrState: primaryPr?.state ?? null,
    primaryLinkedPrLabels
  });

  return {
    issueNumber: issue.number,
    issueUrl: issue.url,
    issueState: issue.state,
    issueLabels,
    primaryLinkedPrUrl: primaryPr?.url ?? null,
    primaryLinkedPrState: primaryPr?.state ?? null,
    primaryLinkedPrLabels,
    group
  };
}

async function listLinkedPullRequestsWithGh(repo: string, issueNumber: number): Promise<GhTriagePr[]> {
  const { stdout } = await execFileAsync("gh", [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--search",
    `linked:issue-${issueNumber}`,
    "--json",
    "number,url,state,labels,mergeStateStatus,closingIssuesReferences",
    "--limit",
    "20"
  ]);
  const prs = JSON.parse(stdout) as GhTriagePr[];
  return prs.filter((pr) => pr.closingIssuesReferences?.some((linkedIssue) => linkedIssue.number === issueNumber));
}

function pickPrimaryPullRequest(prs: GhTriagePr[]): GhTriagePr | null {
  return prs.find((pr) => pr.state === "OPEN") ?? prs[0] ?? null;
}

export async function ensureTaskixLabels(repo: string): Promise<void> {
  await Promise.all(allTaskixLabels().map((label) => ensureLabel(repo, label)));
}

export async function createIssueWithGh(repo: string, issue: IssueSpec): Promise<{ number: number | null; htmlUrl: string | null; mock: false }> {
  await ensureTaskixLabels(repo);
  const body = buildIssueBody(issue);
  const labels = ["taskix:planned", roleLabel(issue.developerRole)];
  const { stdout } = await execFileAsync("gh", ["issue", "create", "--repo", repo, "--title", issue.title, "--body", body, "--label", labels.join(",")]);
  const htmlUrl = stdout.trim() || null;
  return { number: extractIssueNumber(htmlUrl), htmlUrl, mock: false };
}

export async function updateIssueWithGh(repo: string, issueNumber: number, issue: Partial<IssueSpec>): Promise<void> {
  const args = ["issue", "edit", String(issueNumber), "--repo", repo];
  if (issue.title) args.push("--title", issue.title);
  if (issue.description || issue.ownedPaths || issue.acceptanceCriteria) {
    args.push("--body", buildIssueBody({
      title: issue.title ?? "",
      description: issue.description ?? "",
      assigneeRole: issue.assigneeRole ?? "developer",
      developerRole: issue.developerRole,
      ownedPaths: issue.ownedPaths ?? [],
      acceptanceCriteria: issue.acceptanceCriteria ?? []
    }));
  }
  if (args.length > 5) await execFileAsync("gh", args);
}

export async function commentIssueWithGh(repo: string, issueNumber: number, body: string): Promise<void> {
  await execFileAsync("gh", ["issue", "comment", String(issueNumber), "--repo", repo, "--body", body]);
}

export async function findPullRequestByHeadWithGh(repo: string, branch: string): Promise<string | null> {
  const { stdout } = await execFileAsync("gh", ["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", "url", "--limit", "1"]);
  const prs = JSON.parse(stdout) as Array<{ url: string }>;
  return prs[0]?.url ?? null;
}

export async function getPullRequestHeadShaWithGh(repo: string, pr: string): Promise<string | null> {
  const { stdout } = await execFileAsync("gh", ["pr", "view", pr, "--repo", repo, "--json", "headRefOid"]);
  const payload = JSON.parse(stdout) as { headRefOid?: string | null };
  return payload.headRefOid?.trim() || null;
}

export async function createPullRequestWithGh(input: {
  repo: string;
  head: string;
  base: string | null;
  title: string;
  body: string;
  labels: string[];
}): Promise<string> {
  await ensureTaskixLabels(input.repo);
  const args = ["pr", "create", "--repo", input.repo, "--head", input.head, "--title", input.title, "--body", input.body];
  if (input.base) args.push("--base", input.base);
  const { stdout } = await execFileAsync("gh", args);
  const prUrl = stdout.trim();
  if (input.labels.length) await addLabelsWithGh(input.repo, prUrl, input.labels);
  return prUrl;
}

export async function addLabelsWithGh(repo: string, target: number | string, labels: string[]): Promise<void> {
  if (!labels.length) return;
  await ensureTaskixLabels(repo);
  await execFileAsync("gh", ["issue", "edit", String(target), "--repo", repo, "--add-label", labels.join(",")]);
}

export async function removeLabelsWithGh(repo: string, target: number | string, labels: string[]): Promise<void> {
  if (!labels.length) return;
  await execFileAsync("gh", ["issue", "edit", String(target), "--repo", repo, "--remove-label", labels.join(",")]);
}

export async function getIssueSnapshotWithGh(repo: string, issueNumber: number): Promise<GhIssueSnapshot> {
  const { stdout: issueStdout } = await execFileAsync("gh", ["issue", "view", String(issueNumber), "--repo", repo, "--json", "number,url,state,labels"]);
  const issue = JSON.parse(issueStdout) as { number: number; url: string; state: string; labels: Array<{ name: string }> };
  const { stdout: prsStdout } = await execFileAsync("gh", [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--search",
    `linked:issue-${issueNumber}`,
    "--json",
    "number,url,state,labels,closingIssuesReferences"
  ]);
  const prs = JSON.parse(prsStdout) as Array<{
    number: number;
    url: string;
    state: string;
    labels: Array<{ name: string }>;
    closingIssuesReferences?: Array<{ number: number }>;
  }>;
  return {
    number: issue.number,
    url: issue.url,
    state: issue.state,
    labels: issue.labels.map((label) => label.name),
    linkedPrs: prs
      .filter((pr) => pr.closingIssuesReferences?.some((linkedIssue) => linkedIssue.number === issueNumber))
      .map((pr) => ({
        number: pr.number,
        url: pr.url,
        state: pr.state,
        labels: pr.labels.map((label) => label.name)
      }))
  };
}

export async function upsertAgentsFileWithGh(input: {
  repo: string;
  projectName: string;
  autoDeploy: boolean;
  path?: string;
}): Promise<void> {
  const filePath = normalizeRepoPath(input.path || "AGENTS.md");
  let existing = "";
  try {
    const { stdout } = await execFileAsync("gh", ["api", `repos/${input.repo}/contents/${encodeRepoPath(filePath)}`, "--jq", ".content"]);
    existing = Buffer.from(stdout.replace(/\n/g, ""), "base64").toString("utf8");
  } catch {
    existing = "";
  }

  const content = existing ? replaceManagedSection(existing, buildAgentsSection(input.projectName, input.autoDeploy)) : `# Repository Agent Instructions\n\n${buildAgentsSection(input.projectName, input.autoDeploy)}\n`;
  const encoded = Buffer.from(content, "utf8").toString("base64");

  const args = ["api", `repos/${input.repo}/contents/${encodeRepoPath(filePath)}`, "--method", "PUT", "-f", `message=chore: update Taskix AGENTS workflow`, "-f", `content=${encoded}`];
  try {
    const { stdout } = await execFileAsync("gh", ["api", `repos/${input.repo}/contents/${encodeRepoPath(filePath)}`, "--jq", ".sha"]);
    args.push("-f", `sha=${stdout.trim()}`);
  } catch {
    // New file.
  }
  await execFileAsync("gh", args);
}

export async function ensureGitHubSshKey(owner: string): Promise<{ privateKeyPath: string; publicKey: string; created: boolean }> {
  const dir = path.join(dataDir, "ssh");
  await mkdir(dir, { recursive: true });
  const safeOwner = owner.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const privateKeyPath = path.join(dir, `github_${safeOwner}_ed25519`);
  const publicKeyPath = `${privateKeyPath}.pub`;
  let created = false;

  if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
    await execFileAsync("ssh-keygen", ["-t", "ed25519", "-C", `taskix-${owner}`, "-f", privateKeyPath, "-N", ""]);
    created = true;
  }

  return {
    privateKeyPath,
    publicKey: (await readFile(publicKeyPath, "utf8")).trim(),
    created
  };
}

const start = "<!-- taskix:workflow:start -->";
const end = "<!-- taskix:workflow:end -->";

function normalizeRepoPath(filePath: string): string {
  return filePath.trim().replace(/^\/+/, "") || "AGENTS.md";
}

function encodeRepoPath(filePath: string): string {
  return normalizeRepoPath(filePath).split("/").map(encodeURIComponent).join("/");
}

function replaceManagedSection(content: string, section: string): string {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);
  if (startIndex >= 0 && endIndex > startIndex) {
    return `${content.slice(0, startIndex)}${section}${content.slice(endIndex + end.length)}`;
  }
  return `${content.trimEnd()}\n\n${section}\n`;
}

function extractIssueNumber(url: string | null): number | null {
  const value = url?.match(/\/issues\/(\d+)\s*$/)?.[1];
  return value ? Number(value) : null;
}

function buildIssueBody(issue: IssueSpec): string {
  const criteria = issue.acceptanceCriteria.length
    ? `\n\nAcceptance Criteria\n${issue.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
    : "";
  const ownedPaths = issue.ownedPaths ?? [];
  const dependencies = issue.dependsOn?.length ? issue.dependsOn.join(", ") : "none";
  const execution = [
    "Execution Plan",
    `Execution order: ${issue.executionOrder ?? "unspecified"}`,
    `Parallel group: ${issue.parallelGroup ?? "none"}`,
    `Depends on: ${dependencies}`
  ].join("\n");
  const ownership = [
    `Developer role: ${issue.developerRole ?? issue.assigneeRole}`,
    "Owned paths:",
    ...ownedPaths.map((item) => `- ${item}`)
  ].join("\n");
  return `${issue.description}\n\n${execution}\n\n${ownership}${criteria}`;
}

async function ensureLabel(repo: string, label: { name: string; color: string; description: string }): Promise<void> {
  try {
    await execFileAsync("gh", ["label", "create", label.name, "--repo", repo, "--color", label.color, "--description", label.description]);
  } catch {
    await execFileAsync("gh", ["label", "edit", label.name, "--repo", repo, "--color", label.color, "--description", label.description]);
  }
}

function buildAgentsSection(projectName: string, autoDeploy: boolean): string {
  return `${start}
## Taskix Workflow

Project: ${projectName}

- PM keeps talking with the user and hands confirmed requirements to the architect.
- Architect creates issues with developerRole and ownedPaths.
- Developers must stay inside ownedPaths.
- QA must validate every developer PR before merge.
- Architect may merge only after QA passes.
- DevOps owns deployment setup, GitHub Actions/CD workflow, deployment secrets guidance, release automation, and rollback planning.
- Automatic deployment is ${autoDeploy ? "enabled after merge when DevOps CD setup is ready." : "disabled until manual approval or DevOps enables CD."}
${end}`;
}
