import { redirect } from "next/navigation";
import { requireConsolePageAuth } from "@/lib/console-auth";

export default async function ProjectRequirementsPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireConsolePageAuth(`/projects/${projectId}/requirements`);
  redirect(`/projects/${encodeURIComponent(projectId)}?panel=requirements`);
}
