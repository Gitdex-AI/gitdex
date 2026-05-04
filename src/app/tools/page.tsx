import { redirect } from "next/navigation";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { listProjects } from "@/lib/store";

export default async function ToolsPage() {
  await requireConsolePageAuth("/tools");
  const latestProject = await latestProjectId();
  redirect(latestProject ? `/projects/${latestProject}?panel=tools` : "/projects/new");
}

async function latestProjectId(): Promise<string | null> {
  const projects = await listProjects();
  return projects
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]?.projectId ?? null;
}
