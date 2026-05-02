import { Badge, Card, Grid, Group, Paper, SimpleGrid, Text, ThemeIcon } from "@mantine/core";
import { Bot, FolderKanban, GitBranch, Workflow } from "lucide-react";
import { PageTitle } from "@/components/PageTitle";
import { WorkflowsTable } from "@/components/Tables";
import { getSettings } from "@/lib/settings";
import { listProjects, listWorkflows } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [settings, projects, workflows] = await Promise.all([getSettings(), listProjects(), listWorkflows()]);

  return (
    <>
      <PageTitle title="Dashboard" />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" mb="md">
        <Stat href="/tools" icon={<Bot size={18} />} label="Codex model" value={settings.codexModel} />
        <Stat href="/settings" icon={<GitBranch size={18} />} label="Fallback repo" value={settings.githubRepo || "not set"} />
        <Stat href="/projects" icon={<FolderKanban size={18} />} label="Projects" value={String(projects.length)} />
        <Stat href="/projects" icon={<Workflow size={18} />} label="Workflows" value={String(workflows.length)} />
      </SimpleGrid>
      <Paper>
        <Group justify="space-between" p="md" className="section-header">
          <div>
            <Text fw={760}>Recent Workflows</Text>
            <Text size="sm" c="dimmed">
              Latest workflow activity across all projects
            </Text>
          </div>
          <Badge variant="light">{workflows.length} total</Badge>
        </Group>
        <WorkflowsTable workflows={workflows} />
      </Paper>
    </>
  );
}

function Stat({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card component="a" href={href} withBorder shadow="xs" padding="md" className="dashboard-stat-card">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" tt="uppercase" fw={800} c="dimmed">
            {label}
          </Text>
          <Text fw={800} size="lg" mt={4}>
            {value}
          </Text>
        </div>
        <ThemeIcon variant="light" size="lg">
          {icon}
        </ThemeIcon>
      </Group>
    </Card>
  );
}
