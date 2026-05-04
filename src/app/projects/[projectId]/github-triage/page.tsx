import { notFound } from "next/navigation";
import { ProjectGitHubTriagePanel } from "@/components/ProjectGitHubTriagePanel";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { resolveGhUserLogin } from "@/lib/gh-status";
import { getProject } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ProjectGitHubTriagePage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireConsolePageAuth(`/projects/${projectId}/github-triage`);
  const project = await getProject(projectId);
  if (!project) notFound();

  const ghUserLogin = await resolveGhUserLogin();
  return <ProjectGitHubTriagePanel project={project} ghUserLogin={ghUserLogin} showBack />;
}
