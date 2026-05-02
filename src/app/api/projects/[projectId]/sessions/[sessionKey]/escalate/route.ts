import { NextResponse } from "next/server";
import { CodexClient } from "@/lib/codex";
import { developerRoleIds } from "@/lib/developer-roles";
import { addLabelsWithGh, commentIssueWithGh, removeLabelsWithGh, updateIssueWithGh } from "@/lib/github-local";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, createJob, getAgentSession, getProject, getWorkflow, listJobs, saveAgentSession, saveProject, saveWorkflow } from "@/lib/store";
import type { DeveloperRoleId } from "@/lib/developer-roles";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; sessionKey: string }> }) {
  const { projectId, sessionKey } = await params;
  const [project, session, settings] = await Promise.all([getProject(projectId), getAgentSession(decodeURIComponent(sessionKey)), getSettings()]);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!session || session.projectId !== project.projectId) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  const lastMessage = [...session.messages].reverse().find((message) => message.role === "assistant") ?? session.messages.at(-1);
  const content = [
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

  const existingArchitectSession = await getAgentSession(`${project.projectId}:architect`);
  const codex = new CodexClient(settings);
  const result = await codex.architectResolveBlocker({
    projectName: project.name,
    githubRepo: project.githubRepo,
    blockedContext: content,
    sessionId: project.architectSessionId ?? existingArchitectSession?.sessionId ?? null
  });

  if (result.sessionId && result.sessionId !== project.architectSessionId) {
    project.architectSessionId = result.sessionId;
    await saveProject(project);
  }

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
  let queuedJobId: string | null = null;

  if (workflow && issue && result.resolution.action === "retry_developer") {
    const developerRole = normalizeDeveloperRole(result.resolution.developerRole);
    issue.title = result.resolution.issueTitle || issue.title;
    issue.description = result.resolution.issueDescription || issue.description;
    issue.developerRole = developerRole;
    issue.ownedPaths = result.resolution.ownedPaths.length ? result.resolution.ownedPaths : issue.ownedPaths;
    issue.acceptanceCriteria = result.resolution.acceptanceCriteria.length ? result.resolution.acceptanceCriteria : issue.acceptanceCriteria;
    issue.labels = [...new Set([...(issue.labels ?? []).filter((label) => !["taskix:blocked", "taskix:spec-blocked", "taskix:qa-failed", "qa-failed"].includes(label.toLowerCase())), "taskix:planned"])];
    workflow.status = "in_progress";
    workflow.timeline.push(`Architect resolved blocker for ${issue.issueId}; queued developer retry.`);

    if (issue.githubIssueNumber) {
      await updateIssueWithGh(project.githubRepo, issue.githubIssueNumber, issue);
      await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, result.resolution.comment || result.resolution.summary);
      await removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, ["taskix:blocked", "taskix:spec-blocked", "taskix:qa-failed", "qa-failed"]);
      await addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, ["taskix:planned"]);
    }

    await saveWorkflow(workflow);
    const existingJob = (await listJobs(project.projectId)).find((job) => (
      job.type === "issue_run"
      && (job.status === "pending" || job.status === "running")
      && job.payload.workflowId === workflow.workflowId
      && job.payload.issueId === issue.issueId
    ));
    const job = existingJob ?? await createJob({
      projectId: project.projectId,
      type: "issue_run",
      payload: { workflowId: workflow.workflowId, issueId: issue.issueId }
    });
    queuedJobId = job.jobId;

    session.status = "active";
    session.currentStep = "developer retry queued by architect";
    session.labels = issue.labels;
    session.updatedAt = new Date().toISOString();
    await saveAgentSession(session);
  } else if (workflow && issue && result.resolution.action === "mark_blocked") {
    workflow.status = "blocked";
    workflow.timeline.push(`Architect marked ${issue.issueId} blocked: ${result.resolution.summary}`);
    if (issue.githubIssueNumber) {
      await commentIssueWithGh(project.githubRepo, issue.githubIssueNumber, result.resolution.comment || result.resolution.summary);
      await addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, ["taskix:blocked"]);
    }
    await saveWorkflow(workflow);
  }

  const resolutionText = [
    `Action: ${result.resolution.action}`,
    result.resolution.summary,
    "",
    result.resolution.comment,
    result.resolution.action === "retry_developer"
      ? `\nRevised issue:\n${result.resolution.issueTitle}\nOwned paths:\n${result.resolution.ownedPaths.map((item) => `- ${item}`).join("\n") || "- none"}\nAcceptance criteria:\n${result.resolution.acceptanceCriteria.map((item) => `- ${item}`).join("\n") || "- none"}`
      : ""
  ].join("\n").trim();

  await appendAgentMessages({
    sessionKey: `${project.projectId}:architect`,
    projectId: project.projectId,
    role: "architect",
    title: "Architect",
    sessionId: result.sessionId ?? project.architectSessionId ?? existingArchitectSession?.sessionId ?? null,
    workflowId: session.workflowId ?? null,
    issueId: session.issueId ?? null,
    messages: [
      { role: "user", content, createdAt: new Date().toISOString() },
      { role: "assistant", content: resolutionText, createdAt: new Date().toISOString() }
    ]
  });

  return NextResponse.json({
    ok: true,
    redirectTo: queuedJobId ? `/projects/${project.projectId}/workflows/${workflow?.workflowId}?autorun=1` : `/projects/${project.projectId}?role=architect`,
    resolution: result.resolution,
    queuedJobId
  });
}

function normalizeDeveloperRole(value: string): DeveloperRoleId {
  return developerRoleIds.includes(value as DeveloperRoleId) ? value as DeveloperRoleId : "general_developer";
}
