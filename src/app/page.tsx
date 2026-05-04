import { redirect } from "next/navigation";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { listProjects } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireConsolePageAuth("/");
  const projects = await listProjects();
  const latestProject = projects
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  if (latestProject) {
    redirect(`/projects/${latestProject.projectId}`);
  }

  redirect("/projects/new");
}
