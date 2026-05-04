import { NextResponse } from "next/server";
import { getProjectTriageFromWorkflows } from "@/lib/project-triage";
import { getProject, listProjectWorkflows } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "Project not found." }, { status: 404 });
  }

  const repo = project.githubRepo.trim();
  if (!repo) {
    return NextResponse.json({ ok: false, projectId: project.projectId, error: "Project has no bound GitHub repo." }, { status: 400 });
  }

  try {
    const workflows = await listProjectWorkflows(project.projectId);
    return NextResponse.json(getProjectTriageFromWorkflows({ projectId: project.projectId, repo, workflows }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub triage read failed.";
    return NextResponse.json({ ok: false, projectId: project.projectId, repo, error: message }, { status: 502 });
  }
}
