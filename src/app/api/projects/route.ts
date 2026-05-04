import { NextResponse } from "next/server";
import { upsertAgentsFileWithGh, verifyLocalGitHubRepo } from "@/lib/github-local";
import { createProject, listProjects } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function GET() {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const projects = await listProjects();
  return NextResponse.json(
    projects.map(({ githubAccessToken: _githubAccessToken, ...project }) => project)
  );
}

export async function POST(request: Request) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const form = await request.formData();
  const projectName = String(form.get("projectName") ?? "").trim();
  const githubRepo = String(form.get("githubRepo") ?? "").trim();
  const githubAccount = String(form.get("githubAccount") ?? "").trim();
  const agentsFilePath = String(form.get("agentsFilePath") ?? "AGENTS.md").trim();
  const autoDeploy = form.get("autoDeploy") === "true";
  const updateAgentsFile = form.get("updateAgentsFile") === "true";

  const error = validateProject(projectName, githubRepo, githubAccount, agentsFilePath);
  if (error) return redirect(request, newProjectPath(githubAccount, error));

  try {
    await verifyLocalGitHubRepo(githubRepo);
    if (updateAgentsFile) {
      await upsertAgentsFileWithGh({
        repo: githubRepo,
        projectName,
        autoDeploy,
        path: agentsFilePath
      });
    }
  } catch (verificationError) {
    const message = verificationError instanceof Error ? verificationError.message : "GitHub connection failed.";
    return redirect(request, newProjectPath(githubAccount, message));
  }

  const project = await createProject({
    name: projectName,
    githubRepo,
    githubAccount,
    githubAccessToken: "",
    autoDeploy,
    agentsFilePath,
    updateAgentsFile
  });
  return redirect(request, `/projects/${project.projectId}?message=${encodeURIComponent(`Project ${project.name} created. Telegram users can switch with /use ${project.slug}.`)}`);
}

function validateProject(name: string, repo: string, account: string, agentsFilePath: string): string | null {
  if (!name) return "Project name is required.";
  if (!account) return "GitHub owner is required.";
  if (!repo.includes("/") || repo.split("/").length !== 2) return "GitHub repo must use owner/repo format.";
  if (repo.split("/")[0].toLowerCase() !== account.toLowerCase()) return "GitHub repo owner must match the selected project owner.";
  if (!agentsFilePath) return "Agent instructions file path is required.";
  if (agentsFilePath.includes("..")) return "Agent instructions file path cannot contain '..'.";
  return null;
}

function newProjectPath(owner: string, error: string): string {
  const params = new URLSearchParams();
  if (owner) params.set("owner", owner);
  params.set("error", error);
  return `/projects/new?${params.toString()}`;
}

function redirect(request: Request, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}
