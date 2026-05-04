import { SettingsPanel } from "@/components/SettingsPanel";
import { recentProjectChatsFromActivity } from "@/components/projects/recent-project-chats";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { listProjects, listWorkflows } from "@/lib/store";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const { message, error } = await searchParams;
  await requireConsolePageAuth(buildSettingsNextPath({ message, error }));
  const [projects, workflows] = await Promise.all([listProjects(), listWorkflows()]);
  return <SettingsPanel message={message} error={error} recentProjectChats={recentProjectChatsFromActivity(projects, workflows)} />;
}

function buildSettingsNextPath({ message, error }: { message?: string; error?: string }): string {
  const params = new URLSearchParams();
  if (message) params.set("message", message);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `/settings?${query}` : "/settings";
}
