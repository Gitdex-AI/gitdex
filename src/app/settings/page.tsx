import { SettingsPanel } from "@/components/SettingsPanel";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { listProjects } from "@/lib/store";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const { message, error } = await searchParams;
  await requireConsolePageAuth(buildSettingsNextPath({ message, error }));
  const projects = await listProjects();
  return <SettingsPanel message={message} error={error} recentProjectChats={projects.map(({ projectId, createdAt }) => ({ projectId, createdAt }))} />;
}

function buildSettingsNextPath({ message, error }: { message?: string; error?: string }): string {
  const params = new URLSearchParams();
  if (message) params.set("message", message);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `/settings?${query}` : "/settings";
}
