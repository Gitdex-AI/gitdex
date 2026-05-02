import { NextResponse } from "next/server";
import { syncWorkflowFromGitHub } from "@/lib/orchestrator";
import { getProject, listProjectWorkflows } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const workflows = await listProjectWorkflows(project.projectId);
  const synced = [];
  for (const workflow of workflows) {
    synced.push(await syncWorkflowFromGitHub(workflow.workflowId, project));
  }
  return NextResponse.json({ synced: synced.length, workflows: synced });
}
