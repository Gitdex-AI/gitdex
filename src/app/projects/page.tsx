import { ProjectsPanel } from "@/components/projects/ProjectsPanel";
import { requireConsolePageAuth } from "@/lib/console-auth";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const { message, error } = await searchParams;
  await requireConsolePageAuth(buildProjectsNextPath({ message, error }));
  return <ProjectsPanel message={message} error={error} />;
}

function buildProjectsNextPath({ message, error }: { message?: string; error?: string }): string {
  const params = new URLSearchParams();
  if (message) params.set("message", message);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `/projects?${query}` : "/projects";
}
