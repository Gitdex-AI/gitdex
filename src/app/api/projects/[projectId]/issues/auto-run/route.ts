import { NextResponse } from "next/server";
import { runProjectIssueAutoRun } from "@/lib/project-auto-runner";
import { getProject } from "@/lib/store";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const body = await request.json().catch(() => ({})) as { workflowIds?: unknown; issueIds?: unknown };
  const workflowIds = Array.isArray(body.workflowIds) ? body.workflowIds.filter((item): item is string => typeof item === "string") : [];
  const issueIds = Array.isArray(body.issueIds) ? body.issueIds.filter((item): item is string => typeof item === "string") : [];
  const result = await runProjectIssueAutoRun(project, { workflowIds, issueIds });
  return NextResponse.json({ ok: true, ...result });
}
