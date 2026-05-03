import { CodexClient } from "@/lib/codex";
import { agentJobMessageId } from "@/lib/agent-run-messages";
import { developerRoleIds } from "@/lib/developer-roles";
import { commentIssueWithGh, updateIssueWithGh } from "@/lib/github-local";
import { transitionIssueStage } from "@/lib/issue-stage";
import { getActiveJobId } from "@/lib/job-runtime";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, createJob, getAgentSession, getWorkflow, listJobs, saveAgentSession, saveWorkflow } from "@/lib/store";
import type { DeveloperRoleId } from "@/lib/developer-roles";
import type { ProjectRecord } from "@/lib/types";

export async function runArchitectBlockerResolution(project: ProjectRecord, sessionKey: string): Promise<void> {
  const [session, settings] = await Promise.all([getAgentSession(sessionKey), getSettings()]);
  if (!session || session.projectId !== project.projectId) throw new Error("Blocked session not found.");

  const startedAt = new Date().toISOString();
  const content = architectBlockerInstruction(session);

  const architectSessionKey = `${session.issueId ?? session.sessionKey}:architect`;
  const existingArchitectSession = await getAgentSession(architectSessionKey);
  const codex = new CodexClient(settings);
  const result = await codex.architectResolveBlocker({
    projectName: project.name,
    githubRepo: project.githubRepo,
    blockedContext: content,
    sessionId: existingArchitectSession?.sessionId ?? null
  });

  const workflow = session.workflowId ? await getWorkflow(session.workflowId) : null;
  const issue = workflow?.issues.find((item) => item.issueId === session.issueId);
  if (issue && result.resolution.action === "request_user_input") {
    result.resolution.action = "retry_developer";
    result.resolution.summary = result.resolution.summary || "Architect resolution fallback: unblock by retrying developer with broadened repository ownership.";
    result.resolution.issueTitle = result.resolution.issueTitle || issue.title;
    result.resolution.issueDescription = result.resolution.issueDescription || [
      issue.description,
      "",
      "Architect blocker resolution: previous execution was blocked. Retry with repository-root ownership so the developer can inspect the actual project structure and choose the minimal safe implementation surface."
    ].join("\n");
    result.resolution.developerRole = result.resolution.developerRole || issue.developerRole || "general_developer";
    result.resolution.ownedPaths = result.resolution.ownedPaths.length ? result.resolution.ownedPaths : ["."];
    result.resolution.acceptanceCriteria = result.resolution.acceptanceCriteria.length ? result.resolution.acceptanceCriteria : issue.acceptanceCriteria;
    result.resolution.comment = "Architect resolved this blocker by broadening ownedPaths to the repository root for retry. Developer must inspect the actual repo structure, keep changes minimal, and satisfy the issue acceptance criteria.";
  }

  if (workflow && issue && result.resolution.action === "retry_developer") {
    const developerRole = normalizeDeveloperRole(result.resolution.developerRole);
    issue.title = result.resolution.issueTitle || issue.title;
    issue.description = result.resolution.issueDescription || issue.description;
    issue.developerRole = developerRole;
    issue.ownedPaths = result.resolution.ownedPaths.length ? result.resolution.ownedPaths : issue.ownedPaths;
    issue.acceptanceCriteria = result.resolution.acceptanceCriteria.length ? result.resolution.acceptanceCriteria : issue.acceptanceCriteria;
    workflow.status = "in_progress";
    workflow.timeline.push(`Architect resolved blocker for ${issue.issueId}; queued developer retry.`);

    if (issue.githubIssueNumber) {
      await updateIssueWithGh(project.githubRepo, issue.githubIssueNumber, issue);
      await transitionIssueStage({ repo: project.githubRepo, issue, stage: "gd:fix", prUrl: issue.prUrl ?? null });
      await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, result.resolution.comment || result.resolution.summary);
    }

    await saveWorkflow(workflow);
    const existingJob = (await listJobs(project.projectId)).find((job) => (
      job.type === "issue_run"
      && (job.status === "pending" || job.status === "running")
      && job.payload.workflowId === workflow.workflowId
      && job.payload.issueId === issue.issueId
    ));
    await (existingJob ?? createJob({
      projectId: project.projectId,
      type: "issue_run",
      payload: { workflowId: workflow.workflowId, issueId: issue.issueId }
    }));

    session.status = "active";
    session.currentStep = "developer retry queued by architect";
    session.labels = issue.labels;
  } else if (workflow && issue && result.resolution.action === "mark_blocked") {
    workflow.status = "blocked";
    workflow.timeline.push(`Architect marked ${issue.issueId} blocked: ${result.resolution.summary}`);
    if (issue.githubIssueNumber) {
      await transitionIssueStage({ repo: project.githubRepo, issue, stage: "gd:blocked", prUrl: issue.prUrl ?? null });
      await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, result.resolution.comment || result.resolution.summary);
    }
    await saveWorkflow(workflow);
    session.status = "blocked";
    session.currentStep = "architect marked blocker unresolved";
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const resolutionText = formatResolutionText(result.resolution);
  const executionLog = result.resolution.executionLog;
  const activeJobId = getActiveJobId();
  const executionLogs = executionLog ? [{
    title: "Architect blocker resolution",
    content: executionLog,
    createdAt: finishedAt,
    status: result.resolution.action === "mark_blocked" ? "failed" as const : "ok" as const,
    durationMs
  }] : [];

  await appendAgentMessages({
    sessionKey: architectSessionKey,
    projectId: project.projectId,
    role: "architect",
    title: "Architect",
    sessionId: result.sessionId ?? existingArchitectSession?.sessionId ?? null,
    workflowId: session.workflowId ?? null,
    issueId: session.issueId ?? null,
    githubIssueNumber: session.githubIssueNumber ?? issue?.githubIssueNumber ?? null,
    githubIssueUrl: session.githubIssueUrl ?? (issue?.githubIssueNumber ? `https://github.com/${project.githubRepo}/issues/${issue.githubIssueNumber}` : null),
    prUrl: session.prUrl ?? issue?.prUrl ?? null,
    labels: issue?.labels ?? session.labels,
    currentStep: result.resolution.action === "retry_developer" ? "blocker resolved" : "blocker reviewed",
    finishedAt,
    durationMs,
    executionLogs: [],
    messages: [
      ...(existingArchitectSession?.messages.some((message) => message.content === content) ? [] : [{ role: "user" as const, content, createdAt: startedAt }]),
      {
        messageId: activeJobId ? agentJobMessageId(activeJobId) : undefined,
        jobId: activeJobId,
        role: "assistant",
        status: result.resolution.action === "mark_blocked" ? "blocked" : "done",
        durationMs,
        executionLogs,
        content: resolutionText,
        createdAt: finishedAt,
        updatedAt: finishedAt
      }
    ]
  });

  session.finishedAt = finishedAt;
  session.durationMs = durationMs;
  session.updatedAt = finishedAt;
  await saveAgentSession(session);
}

export function architectBlockerInstruction(session: {
  title: string;
  sessionKey: string;
  workflowId?: string | null;
  issueId?: string | null;
  githubIssueNumber?: number | null;
  prUrl?: string | null;
  currentStep?: string | null;
  status: string;
  messages: Array<{ role: string; content: string }>;
}): string {
  const lastMessage = [...session.messages].reverse().find((message) => message.role === "assistant") ?? session.messages.at(-1);
  return [
    `Blocked session needs architect resolution: ${session.title}`,
    "",
    `Session: ${session.sessionKey}`,
    `Workflow: ${session.workflowId ?? "none"}`,
    `Issue: ${session.issueId ?? "none"}`,
    `GitHub issue: ${session.githubIssueNumber ? `#${session.githubIssueNumber}` : "none"}`,
    `PR: ${session.prUrl ?? "none"}`,
    `Current step: ${session.currentStep ?? "unknown"}`,
    `Status: ${session.status}`,
    "",
    "Blocked output:",
    lastMessage?.content ?? "No detailed blocked output was recorded.",
    "",
    "Resolve this blocker so the workflow can continue. If safe, correct the issue scope and return retry_developer."
  ].join("\n");
}

function formatResolutionText(resolution: {
  action: string;
  summary: string;
  comment: string;
  issueTitle: string;
  ownedPaths: string[];
  acceptanceCriteria: string[];
}): string {
  return [
    `Action: ${resolution.action}`,
    resolution.summary,
    "",
    resolution.comment,
    resolution.action === "retry_developer"
      ? `\nRevised issue:\n${resolution.issueTitle}\nOwned paths:\n${resolution.ownedPaths.map((item) => `- ${item}`).join("\n") || "- none"}\nAcceptance criteria:\n${resolution.acceptanceCriteria.map((item) => `- ${item}`).join("\n") || "- none"}`
      : ""
  ].join("\n").trim();
}

function normalizeDeveloperRole(value: string): DeveloperRoleId {
  return developerRoleIds.includes(value as DeveloperRoleId) ? value as DeveloperRoleId : "general_developer";
}
