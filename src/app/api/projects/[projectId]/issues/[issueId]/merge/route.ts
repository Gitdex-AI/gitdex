import { NextResponse } from "next/server";
import { appendAgentRunPlaceholder } from "@/lib/agent-run-messages";
import { architectMergeInstruction } from "@/lib/architect-runner";
import { appendAgentMessages, createJob, getAgentSession, getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; issueId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, issueId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const workflows = await listProjectWorkflows(project.projectId);
  const workflow = workflows.find((item) => item.issues.some((issue) => issue.issueId === issueId));
  const issue = workflow?.issues.find((item) => item.issueId === issueId);
  if (!workflow || !issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  if (!issue.prUrl) return NextResponse.json({ error: "Issue has no pull request to merge." }, { status: 400 });
  if (issue.prState === "MERGED") return NextResponse.json({ ok: true, merged: true, issueId, prUrl: issue.prUrl });

  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  const isReady = labels.has("taskix:ready-to-merge");
  if (!isReady) {
    return NextResponse.json({
      error: "Reviewer code review must pass before merge.",
      action: "Run Review after QA passes. Merge is only enabled after taskix:ready-to-merge is applied."
    }, { status: 409 });
  }

  const existingJob = (await listJobs(project.projectId)).find((job) => (
    job.type === "merge_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));
  workflow.status = "in_progress";
  workflow.timeline.push(existingJob ? `Reviewer merge job already queued for ${issue.issueId}.` : `Reviewer merge job queued for ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const sessionKey = `${issue.issueId}:reviewer`;
  const mergeInstruction = architectMergeInstruction(project, issue);
  const existingReviewerSession = await getAgentSession(sessionKey);
  if (!existingReviewerSession?.messages.some((message) => message.content === mergeInstruction)) {
    const startedAt = new Date().toISOString();
    await appendAgentMessages({
      sessionKey,
      projectId: project.projectId,
      role: "reviewer",
      title: "Reviewer",
      sessionId: existingReviewerSession?.sessionId ?? null,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      prUrl: issue.prUrl,
      labels: issue.labels ?? [],
      status: "active",
      currentStep: "merge requested",
      startedAt,
      messages: [
        { role: "user", content: mergeInstruction, createdAt: startedAt }
      ]
    });
  }

  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "merge_run",
    payload: {
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      prUrl: issue.prUrl
    }
  });
  await appendAgentRunPlaceholder({
    project,
    workflow,
    issue,
    job,
    sessionKey,
    role: "reviewer",
    title: "Reviewer",
    label: "Reviewer",
    sessionId: existingReviewerSession?.sessionId ?? null,
    currentStep: "merge requested",
    prUrl: issue.prUrl,
    labels: issue.labels ?? []
  });

  return NextResponse.json({
    ok: true,
    delegated: true,
    jobId: job.jobId,
    runStatus: job.status,
    issueId,
    prUrl: issue.prUrl,
    architectUrl: `/projects/${project.projectId}?session=${encodeURIComponent(sessionKey)}`
  });
}
