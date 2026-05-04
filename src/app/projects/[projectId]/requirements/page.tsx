import { notFound } from "next/navigation";
import { Badge, Button, Code, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { Archive, ArrowLeft } from "lucide-react";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { getProject, listProjectWorkflows } from "@/lib/store";
import type { WorkflowRecord } from "@/lib/types";

export default async function ProjectRequirementsPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireConsolePageAuth(`/projects/${projectId}/requirements`);
  const project = await getProject(projectId);
  if (!project) notFound();

  const workflows = (await listProjectWorkflows(project.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const archivedCount = workflows.filter((workflow) => workflow.archivedAt).length;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Button component="a" href={`/projects/${project.projectId}?phase=requirements`} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />}>
            Back to project
          </Button>
          <Group gap="sm" mt="sm">
            <Title order={1}>Requirements</Title>
            <Badge variant="light">{workflows.length} total</Badge>
            {archivedCount ? <Badge variant="outline" color="gray">{archivedCount} archived</Badge> : null}
          </Group>
          <Text c="dimmed" size="sm">
            Numbered requirements for {project.name}.
          </Text>
        </div>
      </Group>

      <Paper>
        <Group justify="space-between" p="md" className="section-header">
          <div>
            <Text fw={760}>All Requirements</Text>
            <Text size="sm" c="dimmed">Requirement number, status, and linked workflow detail.</Text>
          </div>
        </Group>
        <Stack p="md" gap="xs">
          {workflows.length ? workflows.map((workflow) => (
            <RequirementListRow key={workflow.workflowId} projectId={project.projectId} workflow={workflow} />
          )) : (
            <Text size="sm" c="dimmed">No numbered requirements yet.</Text>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

function RequirementListRow({ projectId, workflow }: { projectId: string; workflow: WorkflowRecord }) {
  return (
    <div className="requirement-row">
      <div className="requirement-row-body">
        <div className="requirement-row-main">
          <a href={`/projects/${projectId}/workflows/${workflow.workflowId}`} className="requirement-row-link">
            <Group gap="xs">
              <Code>{workflow.trackingCode ?? workflow.workflowId}</Code>
              <Badge size="xs" variant="light">{workflow.status}</Badge>
              {workflow.archivedAt ? <Badge size="xs" variant="outline" color="gray">Archived</Badge> : null}
              <Badge size="xs" variant="outline">{workflow.issues.length} issue{workflow.issues.length === 1 ? "" : "s"}</Badge>
            </Group>
            <Text size="sm" mt={6} lineClamp={2}>{workflow.userRequirement}</Text>
            <Text size="xs" c="dimmed" mt={4}>{workflow.archivedAt ? `Archived ${formatDate(workflow.archivedAt)}` : `Created ${formatDate(workflow.createdAt)}`}</Text>
          </a>
        </div>
        {!workflow.archivedAt && workflow.trackingCode ? <ArchiveRequirementForm projectId={projectId} workflowId={workflow.workflowId} /> : null}
      </div>
    </div>
  );
}

function ArchiveRequirementForm({ projectId, workflowId }: { projectId: string; workflowId: string }) {
  return (
    <form method="post" action={`/api/projects/${projectId}/requirements/${workflowId}/archive`}>
      <Button type="submit" variant="light" color="red" size="compact-xs" radius="xl" leftSection={<Archive size={14} />}>
        Archive
      </Button>
    </form>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
