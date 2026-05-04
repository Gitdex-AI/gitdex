import { Alert, Button, Group, Paper, Text } from "@mantine/core";
import { FolderPlus, Info } from "lucide-react";
import { PageTitle } from "@/components/PageTitle";
import { ProjectsTable } from "@/components/Tables";
import { listProjects, listWorkflows } from "@/lib/store";
import { ProjectListHeaderActions } from "./ProjectListReturnControls";
import { projectsWithLatestChatActivity } from "./recent-project-chats";

export async function ProjectsPanel({ message, error }: { message?: string; error?: string }) {
  const [projects, workflows] = await Promise.all([listProjects(), listWorkflows()]);
  const projectsWithLatest = projectsWithLatestChatActivity(projects, workflows);
  const recentProjectChats = projectsWithLatest.map((project) => ({
    projectId: project.projectId,
    latestAt: project.latestAt,
    createdAt: project.createdAt
  }));

  return (
    <>
      <PageTitle title="Projects" />
      {(message || error) && (
        <Alert color={error ? "red" : "blue"} icon={<Info size={16} />} mb="md">
          {message ?? error}
        </Alert>
      )}
      <Paper>
        <Group justify="space-between" p="md" className="section-header">
          <div>
            <Text fw={760}>Projects</Text>
            <Text size="sm" c="dimmed">
              Switch project context from the left sidebar, or add a new GitHub-backed project.
            </Text>
          </div>
          <ProjectListHeaderActions recentProjectChats={recentProjectChats}>
            <Button component="a" href="/projects/new" leftSection={<FolderPlus size={16} />}>
              Add Project
            </Button>
          </ProjectListHeaderActions>
        </Group>
        <ProjectsTable projects={projectsWithLatest} />
      </Paper>
    </>
  );
}
