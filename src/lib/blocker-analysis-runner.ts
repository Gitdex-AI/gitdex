import { agentJobMessageId } from "@/lib/agent-run-messages";
import { CodexClient } from "@/lib/codex";
import { getActiveJobId } from "@/lib/job-runtime";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, getAgentSession, getWorkflow, listJobs, saveWorkflow } from "@/lib/store";
import type { BlockerAnalysisResult, IssueRecord, JobRecord, ProjectRecord } from "@/lib/types";

export async function runIssueBlockerAnalysis(project: ProjectRecord, workflowId: string, issueId: string): Promise<void> {
  const [workflow, settings, jobs] = await Promise.all([getWorkflow(workflowId), getSettings(), listJobs(project.projectId)]);
  if (!workflow) throw new Error("Workflow not found.");
  const issue = workflow.issues.find((item) => item.issueId === issueId);
  if (!issue) throw new Error("Issue not found.");
  if (!project.githubRepo) throw new Error("Project has no GitHub repo configured.");

  const startedAt = new Date().toISOString();
  const sessionKey = blockerAnalysisSessionKey(issue);
  const existing = await getAgentSession(sessionKey);
  const codex = new CodexClient(settings);
  const result = await codex.analyzeIssueBlocker({
    projectName: project.name,
    githubRepo: project.githubRepo,
    issueId: issue.issueId,
    issueNumber: issue.githubIssueNumber ?? null,
    prUrl: issue.prUrl ?? null,
    context: blockerAnalysisContext(issue, jobs)
  });

  workflow.timeline.push(`Analyzed blocker for ${issue.issueId}: ${result.recommendedAction}.`);
  await saveWorkflow(workflow);

  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const activeJobId = getActiveJobId();
  const executionLogs = result.executionLog ? [{
    title: "Blocker analysis Codex execution",
    content: result.executionLog,
    createdAt: finishedAt,
    status: "ok" as const,
    durationMs
  }] : [];

  await appendAgentMessages({
    sessionKey,
    projectId: project.projectId,
    role: "architect",
    title: "Blocker analysis",
    sessionId: existing?.sessionId ?? null,
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    githubIssueNumber: issue.githubIssueNumber ?? null,
    githubIssueUrl: issue.githubIssueUrl ?? null,
    prUrl: issue.prUrl ?? null,
    labels: issue.labels ?? [],
    status: "done",
    currentStep: "blocker analysis complete",
    finishedAt,
    durationMs,
    messages: [
      {
        messageId: activeJobId ? agentJobMessageId(activeJobId) : undefined,
        jobId: activeJobId,
        role: "assistant",
        status: "done",
        durationMs,
        executionLogs,
        content: formatBlockerAnalysis(result),
        createdAt: finishedAt,
        updatedAt: finishedAt
      }
    ]
  });
}

export function blockerAnalysisSessionKey(issue: Pick<IssueRecord, "issueId">): string {
  return `${issue.issueId}:blocker-analysis`;
}

function blockerAnalysisContext(issue: IssueRecord, jobs: JobRecord[]): string {
  const issueJobs = jobs
    .filter((job) => job.payload.issueId === issue.issueId)
    .slice(0, 8)
    .map((job) => [
      `- ${job.type} ${job.status} ${job.jobId}`,
      `  updated: ${job.updatedAt}`,
      job.error ? `  error: ${limit(job.error, 1000)}` : null,
      job.runtime?.agentFinalStatus ? `  final: ${job.runtime.agentFinalStatus} ${job.runtime.agentFinalSummary ?? ""}` : null,
      job.runtime?.outputTail ? `  outputTail:\n${indent(limit(job.runtime.outputTail, 3000))}` : null
    ].filter(Boolean).join("\n"))
    .join("\n");

  return [
    `Issue id: ${issue.issueId}`,
    `GitHub issue: ${issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : "none"}`,
    `Title: ${issue.title}`,
    `Description:\n${issue.description}`,
    `Labels: ${(issue.labels ?? []).join(", ") || "none"}`,
    `PR: ${issue.prUrl ?? "none"}`,
    `PR state: ${issue.prState ?? "unknown"}`,
    `Branch: ${issue.branch ?? "unknown"}`,
    `Owned paths: ${(issue.ownedPaths ?? []).join(", ") || "none"}`,
    `Acceptance criteria:\n${(issue.acceptanceCriteria ?? []).map((item) => `- ${item}`).join("\n") || "- none"}`,
    "",
    "Recent Gitdex jobs:",
    issueJobs || "none"
  ].join("\n");
}

function formatBlockerAnalysis(result: BlockerAnalysisResult): string {
  return [
    `Recommended action: ${formatAction(result.recommendedAction)}`,
    `Blocker type: ${result.blockerType}`,
    "",
    result.summary,
    "",
    result.userExplanation,
    result.risks.length ? `\nRisks:\n${result.risks.map((risk) => `- ${risk}`).join("\n")}` : ""
  ].join("\n").trim();
}

function formatAction(action: BlockerAnalysisResult["recommendedAction"]): string {
  if (action === "reset_to_dev") return "Reset to Dev";
  if (action === "run_architect") return "Run Architect";
  if (action === "fix_environment") return "Fix environment";
  if (action === "manual_review") return "Manual review";
  return "Close issue";
}

function limit(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n... truncated ${trimmed.length - maxChars} chars ...`;
}

function indent(value: string): string {
  return value.split("\n").map((line) => `    ${line}`).join("\n");
}
