import { NextResponse } from "next/server";
import { runProjectIssueAutoRun } from "@/lib/project-auto-runner";
import { getProject } from "@/lib/store";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const result = await runProjectIssueAutoRun(project);
  return NextResponse.json({ ok: true, ...result });
}
