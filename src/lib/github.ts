import type { IssueSpec } from "@/lib/types";

type GitHubUserResponse = {
  login: string;
};

type GitHubRepoResponse = {
  full_name: string;
  html_url: string;
  has_issues: boolean;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
};

type GitHubContentResponse = {
  content: string;
  encoding: string;
  sha: string;
};

const AGENTS_START = "<!-- gitdex:workflow:start -->";
const AGENTS_END = "<!-- gitdex:workflow:end -->";

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly repo: string,
    private readonly apiUrl = "https://api.github.com"
  ) {}

  get enabled(): boolean {
    return Boolean(this.token && this.repo);
  }

  async verifyConnection(expectedAccount: string): Promise<{
    accountLogin: string;
    repoFullName: string;
    repoUrl: string;
    permission: string;
  }> {
    if (!this.enabled) {
      throw new Error("GitHub token and repo are required.");
    }

    const user = await this.request<GitHubUserResponse>("/user");
    if (user.login.toLowerCase() !== expectedAccount.toLowerCase()) {
      throw new Error(`GitHub token belongs to ${user.login}, not ${expectedAccount}.`);
    }

    const repo = await this.request<GitHubRepoResponse>(`/repos/${this.repo}`);
    if (!repo.has_issues) {
      throw new Error(`GitHub Issues are disabled for ${repo.full_name}.`);
    }

    return {
      accountLogin: user.login,
      repoFullName: repo.full_name,
      repoUrl: repo.html_url,
      permission: summarizePermission(repo.permissions)
    };
  }

  async createIssue(issue: IssueSpec): Promise<{ number: number | null; htmlUrl: string | null; mock: boolean }> {
    if (!this.enabled) return { number: null, htmlUrl: null, mock: true };

    const criteria = issue.acceptanceCriteria.length
      ? `\n\nAcceptance Criteria\n${issue.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
      : "";
    const ownedPaths = issue.ownedPaths ?? [];
    const ownership = [
      `Developer role: ${issue.developerRole ?? issue.assigneeRole}`,
      "Owned paths:",
      ...ownedPaths.map((item) => `- ${item}`)
    ].join("\n");
    const response = await fetch(`${this.apiUrl.replace(/\/$/, "")}/repos/${this.repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: issue.title,
        body: `${issue.description}\n\n${ownership}${criteria}`
      })
    });

    if (!response.ok) {
      throw new Error(`GitHub issue creation failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { number: number; html_url: string };
    return { number: data.number, htmlUrl: data.html_url, mock: false };
  }

  async upsertAgentsFile(input: {
    projectName: string;
    autoDeploy: boolean;
    path?: string;
  }): Promise<{ path: string; updated: boolean }> {
    if (!this.enabled) throw new Error("GitHub token and repo are required.");

    const filePath = normalizeRepoPath(input.path || "AGENTS.md");
    const existing = await this.readContent(filePath);
    const managedSection = buildGitdexAgentsSection(input.projectName, input.autoDeploy);
    const nextContent = existing
      ? replaceManagedSection(existing.content, managedSection)
      : `# Repository Agent Instructions\n\n${managedSection}\n`;

    await this.request(`/repos/${this.repo}/contents/${encodeRepoPath(filePath)}`, {
      method: "PUT",
      body: JSON.stringify({
        message: existing ? "chore: update Gitdex AGENTS workflow" : "chore: add Gitdex AGENTS workflow",
        content: Buffer.from(nextContent, "utf8").toString("base64"),
        sha: existing?.sha
      })
    });

    return { path: filePath, updated: Boolean(existing) };
  }

  private async readContent(pathname: string): Promise<{ content: string; sha: string } | null> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, "")}/repos/${this.repo}/contents/${encodeRepoPath(pathname)}`, {
      headers: this.headers()
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`GitHub content read failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as GitHubContentResponse;
    const content = data.encoding === "base64" ? Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8") : data.content;
    return { content, sha: data.sha };
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, "")}${pathname}`, {
      ...init,
      headers: {
        ...this.headers(),
        ...init.headers
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub connection failed: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }
}

function summarizePermission(permissions: GitHubRepoResponse["permissions"]): string {
  if (!permissions) return "unknown";
  if (permissions.admin) return "admin";
  if (permissions.maintain) return "maintain";
  if (permissions.push) return "write";
  if (permissions.triage) return "triage";
  if (permissions.pull) return "read";
  return "unknown";
}

function normalizeRepoPath(pathname: string): string {
  const normalized = pathname.trim().replace(/^\/+/, "") || "AGENTS.md";
  return normalized.toLowerCase() === "agent.md" ? "AGENTS.md" : normalized;
}

function encodeRepoPath(pathname: string): string {
  return pathname.split("/").map(encodeURIComponent).join("/");
}

function replaceManagedSection(content: string, managedSection: string): string {
  const start = content.indexOf(AGENTS_START);
  const end = content.indexOf(AGENTS_END);
  if (start >= 0 && end > start) {
    return `${content.slice(0, start)}${managedSection}${content.slice(end + AGENTS_END.length)}`;
  }
  return `${content.trimEnd()}\n\n${managedSection}\n`;
}

function buildGitdexAgentsSection(projectName: string, autoDeploy: boolean): string {
  return `${AGENTS_START}
## Gitdex Workflow

Project: ${projectName}

All Codex roles must follow this workflow:

- Product manager stays available for user conversation and only hands confirmed requirements to the architect.
- Architect decomposes confirmed requirements into GitHub issues and defines dynamic developer roles.
- Every developer issue must include a concrete developerRole and ownedPaths.
- Developers must work only inside their ownedPaths unless the issue explicitly documents a cross-directory integration point.
- Developers must not revert or overwrite work owned by other parallel developers.
- QA must validate every completed developer PR against acceptance criteria and ownedPaths before merge.
- If QA finds defects, QA creates follow-up issues and the original work is blocked until fixes pass QA.
- Architect may merge only after QA passes.
- Architect owns final code review and merge decision.
- DevOps owns deployment setup, GitHub Actions/CD workflow, deployment secrets guidance, release automation, and rollback planning.
- Automatic deployment is ${autoDeploy ? "enabled for this project after merge when DevOps CD setup is ready." : "disabled until manual approval or DevOps enables CD."}
${AGENTS_END}`;
}
