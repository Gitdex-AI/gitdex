import { NextResponse } from "next/server";
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
      error: "Architect code review must pass before merge.",
      action: "Run Architect review after QA passes. Merge is only enabled after taskix:ready-to-merge is applied."
    }, { status: 409 });
  }

  const existingJob = (await listJobs(project.projectId)).find((job) => (
    job.type === "merge_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));
  workflow.status = "in_progress";
  workflow.timeline.push(existingJob ? `Architect merge job already queued for ${issue.issueId}.` : `Architect merge job queued for ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const sessionKey = `${project.projectId}:architect`;
  const mergeInstruction = architectMergeInstruction(project, issue);
  const existingArchitectSession = await getAgentSession(sessionKey);
  if (!existingArchitectSession?.messages.some((message) => message.content === mergeInstruction)) {
    const startedAt = new Date().toISOString();
    await appendAgentMessages({
      sessionKey,
      projectId: project.projectId,
      role: "architect",
      title: "Architect",
      sessionId: project.architectSessionId ?? existingArchitectSession?.sessionId ?? null,
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

  return NextResponse.json({
    ok: true,
    delegated: true,
    jobId: job.jobId,
    runStatus: job.status,
    issueId,
    prUrl: issue.prUrl,
    architectUrl: `/projects/${project.projectId}?session=${encodeURIComponent(`${project.projectId}:architect`)}`
  });
}
