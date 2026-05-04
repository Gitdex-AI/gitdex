import type { ProjectRecord, WorkflowRecord } from "@/lib/types";
import type { RecentProjectChat } from "@/lib/return-navigation";

export type ProjectWithLatestActivity = ProjectRecord & { latestAt: string };

export function projectsWithLatestChatActivity(projects: ProjectRecord[], workflows: WorkflowRecord[]): ProjectWithLatestActivity[] {
  const latestWorkflowByProject = new Map<string, string>();
  for (const workflow of workflows) {
    if (!workflow.projectId) continue;
    const current = latestWorkflowByProject.get(workflow.projectId);
    if (!current || workflow.createdAt > current) latestWorkflowByProject.set(workflow.projectId, workflow.createdAt);
  }

  return projects
    .map((project) => ({
      ...project,
      latestAt: latestWorkflowByProject.get(project.projectId) ?? project.createdAt
    }))
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

export function recentProjectChatsFromActivity(projects: ProjectRecord[], workflows: WorkflowRecord[]): RecentProjectChat[] {
  return projectsWithLatestChatActivity(projects, workflows).map((project) => ({
    projectId: project.projectId,
    latestAt: project.latestAt,
    createdAt: project.createdAt
  }));
}
