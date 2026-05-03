import { NextResponse } from "next/server";
import { appendAgentRunPlaceholder } from "@/lib/agent-run-messages";
import { developerIssueInstruction } from "@/lib/orchestrator";
import { appendAgentMessages, createJob, getProject, listJobs, listProjectWorkflows, saveWorkflow } from "@/lib/store";
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
  if (issue.prState === "MERGED") return NextResponse.json({ error: "Merged issues cannot run developer work." }, { status: 409 });

  const jobs = await listJobs(project.projectId);
  const existingJob = jobs.find((job) => (
    job.type === "issue_run"
    && (job.status === "pending" || job.status === "running")
    && job.payload.workflowId === workflow.workflowId
    && job.payload.issueId === issue.issueId
  ));

  workflow.status = "in_progress";
  workflow.timeline.push(existingJob ? `Developer job already queued for ${issue.issueId}.` : `Developer job queued for ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const sessionKey = issue.developerSessionId ?? `${issue.issueId}:developer`;
  const developerInstruction = developerIssueInstruction(issue);
  const startedAt = new Date().toISOString();
  await appendAgentMessages({
    sessionKey,
    projectId: project.projectId,
    role: "developer",
    title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
    workflowId: workflow.workflowId,
    issueId: issue.issueId,
    developerRole: issue.developerRole ?? "general_developer",
    ownedPaths: issue.ownedPaths ?? [],
    status: "active",
    currentStep: "developer handling GitHub issue",
    startedAt,
    githubIssueNumber: issue.githubIssueNumber,
    githubIssueUrl: issue.githubIssueUrl ?? null,
    prUrl: issue.prUrl ?? null,
    labels: ["taskix:dev-running"],
    messages: [
      { role: "user", content: developerInstruction, createdAt: startedAt }
    ]
  });

  const job = existingJob ?? await createJob({
    projectId: project.projectId,
    type: "issue_run",
    payload: {
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      prUrl: issue.prUrl ?? null,
      branch: issue.branch ?? null,
      returnedFromQa: false,
      previousPrUrl: issue.prUrl ?? null
    }
  });
  await appendAgentRunPlaceholder({
    project,
    workflow,
    issue,
    job,
    sessionKey,
    role: "developer",
    title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
    label: issue.developerRole ?? "Dev",
    developerRole: issue.developerRole ?? "general_developer",
    currentStep: "developer handling GitHub issue",
    labels: ["taskix:dev-running"]
  });

  return NextResponse.json({
    ok: true,
    jobId: job.jobId,
    runStatus: job.status,
    redirectTo: `/projects/${project.projectId}/workflows/${workflow.workflowId}?autorun=1&job=${job.jobId}`
  });
}
