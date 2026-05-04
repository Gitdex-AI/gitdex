import { ToolsPanel } from "@/components/ToolsPanel";
import { recentProjectChatsFromActivity } from "@/components/projects/recent-project-chats";
import { ToolsReturnControl } from "@/components/tools/ToolsReturnControls";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { listProjects, listWorkflows } from "@/lib/store";

export default async function ToolsPage() {
  await requireConsolePageAuth("/tools");
  const [projects, workflows] = await Promise.all([listProjects(), listWorkflows()]);
  const recentProjectChats = recentProjectChatsFromActivity(projects, workflows);

  return <ToolsPanel headerActions={<ToolsReturnControl recentProjectChats={recentProjectChats} />} />;
}
