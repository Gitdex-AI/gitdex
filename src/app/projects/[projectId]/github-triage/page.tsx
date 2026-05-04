import { redirect } from "next/navigation";
import { requireConsolePageAuth } from "@/lib/console-auth";

export default async function ProjectGitHubTriagePage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireConsolePageAuth(`/projects/${projectId}/github-triage`);
  redirect(`/projects/${encodeURIComponent(projectId)}?panel=triage`);
}
