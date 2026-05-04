import { Badge, Group, Paper, SimpleGrid, Text, ThemeIcon } from "@mantine/core";
import { CheckCircle2, GitBranch, PlayCircle, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { PageTitle } from "@/components/PageTitle";
import { CodexStatusPanel } from "@/components/CodexStatusPanel";
import { GhStatusPanel } from "@/components/GhStatusPanel";

export function ToolsPanel({ headerActions }: { headerActions?: ReactNode }) {
  return (
    <>
      <PageTitle title="Tools" />
      <Paper mb="md">
        <Group justify="space-between" p="md" className="section-header">
          <div>
            <Text fw={760}>Readiness Checklist</Text>
            <Text size="sm" c="dimmed">
              Confirm these prerequisites before creating projects or running workflows.
            </Text>
          </div>
          <Group gap="xs" wrap="nowrap">
            {headerActions}
            <Badge variant="light">local setup</Badge>
          </Group>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" p="md">
          <ChecklistItem icon={<Terminal size={16} />} title="Codex CLI" detail="`codex exec` works with the configured model." />
          <ChecklistItem icon={<GitBranch size={16} />} title="GitHub CLI" detail="`gh auth status` is authenticated over SSH." />
          <ChecklistItem icon={<PlayCircle size={16} />} title="Workflow Run" detail="Project is bound to a repo before jobs run." />
        </SimpleGrid>
      </Paper>
      <CodexStatusPanel />
      <GhStatusPanel />
    </>
  );
}

function ChecklistItem({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <Group align="flex-start" gap="sm" wrap="nowrap">
      <ThemeIcon variant="light" size="md">
        {icon}
      </ThemeIcon>
      <div>
        <Group gap={6}>
          <CheckCircle2 size={13} />
          <Text fw={720} size="sm">{title}</Text>
        </Group>
        <Text size="xs" c="dimmed">{detail}</Text>
      </div>
    </Group>
  );
}
