import { NextResponse } from "next/server";
import { cancelAutoRunJobs, getAutoRunState, updateAutoRunState } from "@/lib/auto-run-control";
import { getProject } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json({ ok: true, state: getAutoRunState(project.projectId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const body = await request.json().catch(() => ({})) as { action?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  if (action === "pause") {
    const state = updateAutoRunState(project.projectId, { status: "pause_requested", message: "Auto Run pause requested." });
    return NextResponse.json({ ok: true, state });
  }
  if (action === "resume") {
    const state = updateAutoRunState(project.projectId, { status: "running", message: "Auto Run resumed." });
    return NextResponse.json({ ok: true, state });
  }
  if (action === "cancel") {
    updateAutoRunState(project.projectId, { status: "cancel_requested", message: "Auto Run cancel requested." });
    const cancelledJobs = await cancelAutoRunJobs(project.projectId, "Cancelled by user from Auto Run controls.");
    return NextResponse.json({ ok: true, state: updateAutoRunState(project.projectId, { status: "cancelled", message: `Auto Run cancelled. ${cancelledJobs} running job(s) stopped.` }) });
  }

  return NextResponse.json({ error: "Unsupported Auto Run control action." }, { status: 400 });
}
