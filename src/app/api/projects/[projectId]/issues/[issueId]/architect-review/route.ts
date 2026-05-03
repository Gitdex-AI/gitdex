import { NextResponse } from "next/server";
import { architectReviewInstruction } from "@/lib/architect-runner";
import { appendAgentMessages, createJob, getAgentSession, getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; issueId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId, issueId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!project.githubRepo) return NextResponse.json({ error: "Project has no GitHub repo configured." }, { status: 400 });

  const workflows = await listProjectWorkflows(project.projectId);
  const workflow = workflows.find((item) => item.issues.some((issue) => issue.issueId === issueId));
  const issue = workflow?.issues.find((item) => item.issueId === issueId);
  if (!workflow || !issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  if (!issue.githubIssueNumber || !issue.prUrl) return NextResponse.json({ error: "Issue has no GitHub PR for architect review." }, { status: 400 });
  if (issue.prState === "MERGED") return NextResponse.json({ error: "Merged PRs do not need architect review." }, { status: 409 });

  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  const qaPassed = labels.has("qa-passed") || labels.has("taskix:qa-passed");
  if (!qaPassed) return NextResponse.json({ error: "Architect review requires QA to pass first." }, { status: 409 });

  const existingJob = (await listJobs(project.projectId)).find((job) => (
    job.type === "architect_review_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));
  workflow.status = "in_progress";
  workflow.timeline.push(existingJob ? `Architect review job already queued for ${issue.issueId}.` : `Architect review job queued for ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const sessionKey = `${project.projectId}:architect`;
  const reviewInstruction = architectReviewInstruction(issue);
  const existingArchitectSession = await getAgentSession(sessionKey);
  if (!existingArchitectSession?.messages.some((message) => message.content === reviewInstruction)) {
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
      labels: issue.prLabels ?? issue.labels ?? [],
      status: "active",
      currentStep: "code review requested",
      startedAt,
      messages: [
        { role: "user", content: reviewInstruction, createdAt: startedAt }
      ]
    });
  }

  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "architect_review_run",
    payload: {
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      prUrl: issue.prUrl
    }
  });

  return NextResponse.json({
    ok: true,
    jobId: job.jobId,
    runStatus: job.status,
    prUrl: issue.prUrl
  });
}
