import { NextResponse } from "next/server";
import { upsertAgentsFileWithGh, verifyLocalGitHubRepo } from "@/lib/github-local";
import { getSettings } from "@/lib/settings";
import { createProject, listProjects } from "@/lib/store";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json(
    projects.map(({ githubAccessToken: _githubAccessToken, ...project }) => project)
  );
}

export async function POST(request: Request) {
  const form = await request.formData();
  const projectName = String(form.get("projectName") ?? "").trim();
  const githubRepo = String(form.get("githubRepo") ?? "").trim();
  const settings = await getSettings();
  const githubAccount = settings.githubUsername;
  const agentsFilePath = String(form.get("agentsFilePath") ?? "AGENTS.md").trim();
  const autoDeploy = form.get("autoDeploy") === "true";
  const updateAgentsFile = form.get("updateAgentsFile") === "true";

  const error = validateProject(projectName, githubRepo, githubAccount, agentsFilePath);
  if (error) return redirect(request, `/projects/new?error=${encodeURIComponent(error)}`);

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
    return redirect(request, `/projects/new?error=${encodeURIComponent(message)}`);
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
  return redirect(request, `/projects?message=${encodeURIComponent(`Project ${project.name} created. Telegram users can switch with /use ${project.slug}.`)}`);
}

function validateProject(name: string, repo: string, account: string, agentsFilePath: string): string | null {
  if (!name) return "Project name is required.";
  if (!account) return "Configure a GitHub owner in Settings first.";
  if (!repo.includes("/") || repo.split("/").length !== 2) return "GitHub repo must use owner/repo format.";
  if (!agentsFilePath) return "Agent instructions file path is required.";
  if (agentsFilePath.includes("..")) return "Agent instructions file path cannot contain '..'.";
  return null;
}

function redirect(request: Request, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, request.url), { status: 303 });
}
