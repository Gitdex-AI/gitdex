import { NextResponse } from "next/server";
import { appendAgentRunPlaceholder } from "@/lib/agent-run-messages";
import { addLabelsWithGh, getPullRequestHeadShaWithGh, removeLabelsWithGh } from "@/lib/github-local";
import { qaValidationInstruction } from "@/lib/orchestrator";
import { appendAgentMessages, cancelPendingJobs, createJob, getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

const removeQaTerminalLabels = ["qa-passed", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:env-blocked", "taskix:ready-to-merge"];
const addQaLabels = ["taskix:need-qa", "taskix:qa-running"];

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
  if (!issue.prUrl) return NextResponse.json({ error: "Issue has no pull request for QA." }, { status: 400 });
  if (issue.prState === "MERGED") return NextResponse.json({ error: "Merged issues cannot be sent to QA." }, { status: 409 });

  let headSha: string | null = null;
  try {
    headSha = await getPullRequestHeadShaWithGh(project.githubRepo, issue.prUrl);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to read PR head SHA.",
      action: "Check GitHub connectivity and retry Handoff to QA. No QA job was queued."
    }, { status: 502 });
  }
  const qaAttempt = nextQaAttempt(await listJobs(project.projectId), workflow.workflowId, issue.issueId);
  const issueLabelsToRemove = labelsToRemove(issue.labels ?? []);
  const prLabelsToRemove = labelsToRemove(issue.prLabels ?? []);
  try {
    if (issue.githubIssueNumber) {
      if (issueLabelsToRemove.length) await removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, issueLabelsToRemove);
      await addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, addQaLabels);
    }
    if (prLabelsToRemove.length) await removeLabelsWithGh(project.githubRepo, issue.prUrl, prLabelsToRemove);
    await addLabelsWithGh(project.githubRepo, issue.prUrl, addQaLabels);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to hand off issue to QA.",
      action: "Check GitHub connectivity and retry Handoff to QA. Local workflow state was not changed."
    }, { status: 502 });
  }

  issue.labels = [
    ...new Set([
      ...(issue.labels ?? []).filter((label) => !removeQaTerminalLabels.includes(label.toLowerCase())),
      ...addQaLabels
    ])
  ];
  issue.prLabels = [
    ...new Set([
      ...(issue.prLabels ?? []).filter((label) => !removeQaTerminalLabels.includes(label.toLowerCase())),
      ...addQaLabels
    ])
  ];
  workflow.status = "in_progress";
  workflow.timeline.push(`Handed ${issue.issueId} to QA.`);
  await saveWorkflow(workflow);

  const sessionKey = issue.qaSessionId ?? `${issue.issueId}:qa`;
  const qaInstruction = qaValidationInstruction(issue.prUrl, issue, headSha);
  const startedAt = new Date().toISOString();
  await appendAgentMessages({
    sessionKey,
    projectId: project.projectId,
    role: "qa",
    title: `QA: ${issue.title}`,
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    ownedPaths: issue.ownedPaths ?? [],
    status: "active",
    currentStep: "QA validating PR",
    startedAt,
    githubIssueNumber: issue.githubIssueNumber,
    githubIssueUrl: issue.githubIssueUrl ?? null,
    prUrl: issue.prUrl,
    labels: addQaLabels,
    messages: [
      { role: "user", content: qaInstruction, createdAt: startedAt }
    ]
  });

  await cancelPendingJobs({
    projectId: project.projectId,
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    type: "qa_run",
    reason: `Superseded by QA handoff attempt ${qaAttempt} for ${issue.prUrl}.`
  });
  const existingJob = (await listJobs(project.projectId)).find((job) => (
    job.type === "qa_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));
  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "qa_run",
    payload: { workflowId: workflow.workflowId, issueId: issue.issueId, prUrl: issue.prUrl, branch: issue.branch ?? null, headSha, qaAttempt }
  });
  await appendAgentRunPlaceholder({
    project,
    workflow,
    issue,
    job,
    sessionKey,
    role: "qa",
    title: `QA: ${issue.title}`,
    label: "QA",
    currentStep: "QA validating PR",
    prUrl: issue.prUrl,
    labels: addQaLabels
  });

  return NextResponse.json({ ok: true, jobId: job.jobId, redirectTo: `/projects/${project.projectId}/workflows/${workflow.workflowId}?autorun=1` });
}

function labelsToRemove(labels: string[]): string[] {
  const lowerLabels = new Set(labels.map((label) => label.toLowerCase()));
  return removeQaTerminalLabels.filter((label) => lowerLabels.has(label));
}

function nextQaAttempt(jobs: Awaited<ReturnType<typeof listJobs>>, workflowId: string, issueId: string): number {
  return jobs
    .filter((job) => job.type === "qa_run" && job.payload.workflowId === workflowId && job.payload.issueId === issueId)
    .map((job) => job.payload.qaAttempt ?? 0)
    .reduce((max, value) => Math.max(max, value), 0) + 1;
}
