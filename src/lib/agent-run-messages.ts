import { appendAgentMessages, getAgentSession } from "@/lib/store";
import type { AgentMessage, AgentSessionRecord, IssueRecord, JobRecord, ProjectRecord, Role, WorkflowRecord } from "@/lib/types";

type RunMessageIssue = Pick<IssueRecord, "issueId" | "githubIssueNumber" | "githubIssueUrl" | "prUrl" | "ownedPaths">;
type RunMessageWorkflow = Pick<WorkflowRecord, "workflowId">;

export function agentJobMessageId(jobId: string): string {
  return `job:${jobId}:assistant`;
}

export function agentWorkingContent(label: string, issue?: Pick<IssueRecord, "githubIssueNumber" | "issueId"> | null): string {
  const issueLabel = issue?.githubIssueNumber ? `issue #${issue.githubIssueNumber}` : issue?.issueId ? `issue ${issue.issueId}` : "";
  return `${label} working${issueLabel ? ` on ${issueLabel}` : ""}...`;
}

export async function appendAgentRunPlaceholder(input: {
  project: ProjectRecord;
  workflow?: RunMessageWorkflow | null;
  issue?: RunMessageIssue | null;
  job: JobRecord;
  sessionKey: string;
  role: Role;
  title: string;
  label: string;
  developerRole?: AgentSessionRecord["developerRole"];
  ownedPaths?: string[];
  githubIssueNumber?: number | null;
  githubIssueUrl?: string | null;
  prUrl?: string | null;
  labels?: string[];
  currentStep: string;
  sessionId?: string | null;
}): Promise<void> {
  const existing = await getAgentSession(input.sessionKey);
  const now = nextMessageTimestamp(existing?.messages.at(-1)?.createdAt);
  const message: AgentMessage = {
    messageId: agentJobMessageId(input.job.jobId),
    jobId: input.job.jobId,
    role: "assistant",
    content: agentWorkingContent(input.label, input.issue),
    status: input.job.status === "pending" ? "pending" : "running",
    createdAt: now,
    updatedAt: now
  };
  await appendAgentMessages({
    sessionKey: input.sessionKey,
    projectId: input.project.projectId,
    role: input.role,
    title: input.title,
    sessionId: input.sessionId,
    workflowId: input.workflow?.workflowId ?? input.job.payload.workflowId ?? null,
    issueId: input.issue?.issueId ?? input.job.payload.issueId ?? null,
    developerRole: input.developerRole,
    ownedPaths: input.ownedPaths ?? input.issue?.ownedPaths ?? [],
    status: "active",
    currentStep: input.currentStep,
    startedAt: now,
    githubIssueNumber: input.githubIssueNumber ?? input.issue?.githubIssueNumber ?? null,
    githubIssueUrl: input.githubIssueUrl ?? input.issue?.githubIssueUrl ?? null,
    prUrl: input.prUrl ?? input.issue?.prUrl ?? null,
    labels: input.labels,
    messages: [message]
  });
}

function nextMessageTimestamp(previous?: string | null): string {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now).toISOString();
}
