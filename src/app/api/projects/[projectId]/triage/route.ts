import { NextResponse } from "next/server";
import { getProjectTriageWithGh } from "@/lib/github-local";
import { getProject } from "@/lib/store";
import type { ProjectTriageGroup, ProjectTriageResponse } from "@/lib/types";
import { requireConsoleApiAuth } from "@/lib/console-auth";

const triageGroups: ProjectTriageGroup[] = ["blocked", "needs_qa", "ready_to_merge", "in_progress", "done", "untracked"];

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
    const items = await getProjectTriageWithGh(repo);
    const groups = Object.fromEntries(triageGroups.map((group) => [group, items.filter((item) => item.group === group)])) as ProjectTriageResponse["groups"];
    const counts = Object.fromEntries(triageGroups.map((group) => [group, groups[group].length])) as ProjectTriageResponse["counts"];

    return NextResponse.json({
      ok: true,
      projectId: project.projectId,
      repo,
      generatedAt: new Date().toISOString(),
      counts,
      groups
    } satisfies ProjectTriageResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub triage read failed.";
    return NextResponse.json({ ok: false, projectId: project.projectId, repo, error: message }, { status: 502 });
  }
}
