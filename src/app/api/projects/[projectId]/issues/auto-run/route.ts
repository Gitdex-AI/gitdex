import { NextResponse } from "next/server";
import { getAutoRunState, isActiveAutoRunState, startAutoRunState, updateAutoRunState } from "@/lib/auto-run-control";
import { runProjectIssueAutoRun } from "@/lib/project-auto-runner";
import { getProject } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const body = await request.json().catch(() => ({})) as { workflowIds?: unknown; issueIds?: unknown };
  const workflowIds = Array.isArray(body.workflowIds) ? body.workflowIds.filter((item): item is string => typeof item === "string") : [];
  const issueIds = Array.isArray(body.issueIds) ? body.issueIds.filter((item): item is string => typeof item === "string") : [];
  if (!issueIds.length) return NextResponse.json({ error: "Auto Run requires the current visible issue list." }, { status: 400 });
  const currentState = getAutoRunState(project.projectId);
  if (isActiveAutoRunState(currentState)) return NextResponse.json({ error: "Auto Run is already running.", state: currentState }, { status: 409 });
  const state = startAutoRunState(project.projectId, { workflowIds, issueIds });
  void runProjectIssueAutoRun(project, { workflowIds, issueIds, initialState: state }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Auto Run failed.";
    updateAutoRunState(project.projectId, { runId: state.runId, status: "failed", message });
  });
  return NextResponse.json({ ok: true, completed: false, steps: [], message: "Auto Run started.", state });
}
