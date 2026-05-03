import { Alert, Anchor, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { AlertCircle, ArrowLeft, ExternalLink, GitBranch, GitPullRequest, Inbox, ListTodo, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectGitHubTriageRefreshButton } from "@/components/ProjectGitHubTriageRefreshButton";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { getProjectTriageWithGh } from "@/lib/github-local";
import { getProject } from "@/lib/store";
import type { ProjectTriageGroup, ProjectTriageItem, ProjectTriageResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const triageGroups: Array<{
  id: ProjectTriageGroup;
  title: string;
  description: string;
  emptyMessage: string;
}> = [
  {
    id: "blocked",
    title: "QA failed / needs fix",
    description: "Issues blocked by failed QA or Gitdex blocker labels.",
    emptyMessage: "No blocked or failed-QA items were found."
  },
  {
    id: "needs_qa",
    title: "Waiting for QA",
    description: "Issues queued for QA validation or still in QA review.",
    emptyMessage: "No items are waiting for QA."
  },
  {
    id: "ready_to_merge",
    title: "QA passed / ready to merge",
    description: "Issues or PRs marked as QA-passed or ready to merge.",
    emptyMessage: "No items are ready to merge."
  },
  {
    id: "in_progress",
    title: "Developer PR",
    description: "Issues with open linked PRs or active developer labels.",
    emptyMessage: "No developer PR items are active."
  },
  {
    id: "done",
    title: "Done",
    description: "Closed issues or merged PR work without active blocker labels.",
    emptyMessage: "No completed items were returned."
  },
  {
    id: "untracked",
    title: "Backlog",
    description: "Open items not yet represented by active Gitdex workflow state.",
    emptyMessage: "No backlog items remain."
  }
];

export default async function ProjectGitHubTriagePage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireConsolePageAuth(`/projects/${projectId}/github-triage`);
  const project = await getProject(projectId);
  if (!project) notFound();

  const triage = await getGitHubTriage(project.projectId, project.githubRepo);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Button component="a" href={`/projects/${project.projectId}`} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />}>
            Back to project
          </Button>
          <Group gap="sm" mt="sm">
            <Title order={1}>GitHub triage</Title>
            <Badge variant="light">{project.githubRepo}</Badge>
          </Group>
          <Text c="dimmed" size="sm">
            Live read-only GitHub queue for operators.
          </Text>
        </div>
        <ProjectGitHubTriageRefreshButton />
      </Group>

      {"error" in triage ? (
        <Paper>
          <Stack p="md" gap="sm">
            <Group gap="sm">
              <ThemeIcon color="red" variant="light" size="lg">
                <AlertCircle size={18} />
              </ThemeIcon>
              <div>
                <Text fw={760}>GitHub data could not be loaded</Text>
                <Text size="sm" c="dimmed">
                  The triage console stays read-only and can be retried with Refresh.
                </Text>
              </div>
            </Group>
            <Alert color="red" variant="light" icon={<AlertCircle size={16} />}>
              {triage.error}
            </Alert>
          </Stack>
        </Paper>
      ) : (
        <>
          <Paper>
            <Group justify="space-between" p="md" className="section-header" align="flex-start">
              <div>
                <Text fw={760}>Repository</Text>
                <Text size="sm" c="dimmed">Live GitHub state grouped by Gitdex workflow state.</Text>
              </div>
              <Stack gap={4} align="flex-end">
                <Anchor href={`https://github.com/${triage.repo}`} target="_blank" rel="noreferrer" size="sm">
                  <Group gap={4} wrap="nowrap">
                    <GitBranch size={14} />
                    {triage.repo}
                    <ExternalLink size={12} />
                  </Group>
                </Anchor>
                <Text size="xs" c="dimmed">Fetched {formatDateTime(triage.generatedAt)}</Text>
              </Stack>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" p="md">
              {triageGroups.map((group) => (
                <Paper key={group.id} withBorder radius="md" p="sm">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={800}>{group.title}</Text>
                  <Text fw={800} size="xl" mt={4}>{triage.counts[group.id]}</Text>
                  <Text size="xs" c="dimmed" mt={6}>{group.description}</Text>
                </Paper>
              ))}
            </SimpleGrid>
          </Paper>

          {!totalItems(triage) ? (
            <Paper>
              <Stack p="xl" align="center" gap="sm">
                <ThemeIcon size={54} radius="xl" variant="light" color="gray">
                  <Inbox size={28} />
                </ThemeIcon>
                <Text fw={760}>No GitHub triage items found</Text>
                <Text size="sm" c="dimmed" ta="center" maw={460}>
                  No GitHub issues matched the Gitdex triage groups for this repository.
                </Text>
              </Stack>
            </Paper>
          ) : (
            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
              {triageGroups.map((group) => (
                <Paper key={group.id}>
                  <Group justify="space-between" p="md" className="section-header" align="flex-start">
                    <div>
                      <Group gap="xs">
                        <ThemeIcon size="sm" radius="xl" variant="light" color={groupTone(group.id)}>
                          {groupIcon(group.id)}
                        </ThemeIcon>
                        <Text fw={760}>{group.title}</Text>
                        <Badge variant="light">{triage.counts[group.id]}</Badge>
                      </Group>
                      <Text size="sm" c="dimmed" mt={4}>{group.description}</Text>
                    </div>
                  </Group>
                  <Stack p="md" gap="sm">
                    {triage.groups[group.id].length ? triage.groups[group.id].map((item) => (
                      <TriageCard key={item.issueNumber} item={item} />
                    )) : (
                      <Text size="sm" c="dimmed">{group.emptyMessage}</Text>
                    )}
                  </Stack>
                </Paper>
              ))}
            </SimpleGrid>
          )}
        </>
      )}
    </Stack>
  );
}

function TriageCard({ item }: { item: ProjectTriageItem }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Group gap="xs">
            <Badge variant="outline">Issue #{item.issueNumber}</Badge>
            {item.primaryLinkedPrState ? <Badge color={item.primaryLinkedPrState === "MERGED" ? "green" : "blue"} variant="light">PR {item.primaryLinkedPrState}</Badge> : null}
          </Group>
          <Text size="sm" c="dimmed" mt={8}>
            Issue state: {item.issueState}
          </Text>
          {item.primaryLinkedPrUrl ? (
            <Anchor href={item.primaryLinkedPrUrl} target="_blank" rel="noreferrer" size="sm" mt={4} display="inline-block">
              <Group gap={4} wrap="nowrap">
                <GitPullRequest size={14} />
                Open linked PR
                <ExternalLink size={12} />
              </Group>
            </Anchor>
          ) : null}
        </div>
        <Anchor href={item.issueUrl} target="_blank" rel="noreferrer" size="sm">
          <Group gap={4} wrap="nowrap">
            <GitBranch size={14} />
            Open issue
            <ExternalLink size={12} />
          </Group>
        </Anchor>
      </Group>
      <Group gap={6} mt="sm">
        {[...item.issueLabels, ...item.primaryLinkedPrLabels].length ? [...item.issueLabels, ...item.primaryLinkedPrLabels].map((label) => (
          <Badge key={label} variant="light">{label}</Badge>
        )) : (
          <Badge variant="outline" color="gray">No labels</Badge>
        )}
      </Group>
    </Paper>
  );
}

async function getGitHubTriage(projectId: string, repo: string): Promise<ProjectTriageResponse | { error: string }> {
  try {
    const items = await getProjectTriageWithGh(repo);
    const groups = Object.fromEntries(triageGroups.map((group) => [group.id, items.filter((item) => item.group === group.id)])) as ProjectTriageResponse["groups"];
    const counts = Object.fromEntries(triageGroups.map((group) => [group.id, groups[group.id].length])) as ProjectTriageResponse["counts"];

    return {
      ok: true,
      projectId,
      repo,
      generatedAt: new Date().toISOString(),
      counts,
      groups
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "GitHub triage failed."
    };
  }
}

function totalItems(triage: ProjectTriageResponse): number {
  return triageGroups.reduce((total, group) => total + triage.counts[group.id], 0);
}

function groupTone(groupId: ProjectTriageGroup): string {
  if (groupId === "blocked") return "red";
  if (groupId === "needs_qa") return "orange";
  if (groupId === "ready_to_merge") return "green";
  if (groupId === "in_progress") return "blue";
  if (groupId === "done") return "gray";
  return "violet";
}

function groupIcon(groupId: ProjectTriageGroup) {
  if (groupId === "blocked") return <ShieldAlert size={12} />;
  if (groupId === "needs_qa") return <TriangleAlert size={12} />;
  if (groupId === "ready_to_merge") return <ShieldCheck size={12} />;
  if (groupId === "in_progress") return <GitPullRequest size={12} />;
  if (groupId === "done") return <ShieldCheck size={12} />;
  return <ListTodo size={12} />;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
