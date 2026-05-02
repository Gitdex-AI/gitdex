import { NextResponse } from "next/server";
import { deleteProject, getProject } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const deleted = await deleteProject(projectId);
  if (!deleted) return NextResponse.json({ ok: false, error: "Project not found." }, { status: 404 });
  return NextResponse.json({ ok: true, projectId: deleted.projectId, slug: deleted.slug });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { projectId } = await params;
  const form = await request.formData();
  const action = String(form.get("_action") ?? "");
  if (action !== "delete") return redirect(request, `/projects/${projectId}?error=${encodeURIComponent("Unsupported project action.")}`);

  const project = await getProject(projectId);
  if (!project) return redirect(request, `/projects?error=${encodeURIComponent("Project not found.")}`);

  const confirmation = String(form.get("confirmation") ?? "").trim();
  if (confirmation !== project.slug) {
    return redirect(request, `/projects/${project.projectId}?error=${encodeURIComponent(`Type ${project.slug} to delete this project.`)}`);
  }

  await deleteProject(project.projectId);
  return redirect(request, `/projects?message=${encodeURIComponent(`Project ${project.name} deleted locally.`)}`);
}

function redirect(request: Request, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}
