"use client";

import { ActionIcon, Badge, Button, Code, Drawer, Group, Stack, Text } from "@mantine/core";
import { Archive, Info, X } from "lucide-react";
import { useState } from "react";
import type { JobRecord, WorkflowRecord } from "@/lib/types";

export function RequirementDetailPanel({
  projectId,
  workflow,
  status,
  planningJob
}: {
  projectId: string;
  workflow: WorkflowRecord;
  status: { label: string; color: string };
  planningJob: JobRecord | null;
}) {
  const [opened, setOpened] = useState(false);
  const code = workflow.trackingCode ?? workflow.workflowId;

  return (
    <>
      <ActionIcon
        type="button"
        variant="subtle"
        color="gray"
        size="sm"
        radius="xl"
        title="Requirement details"
        aria-label="Requirement details"
        onClick={() => setOpened(true)}
      >
        <Info size={14} />
      </ActionIcon>
      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        position="right"
        size="min(520px, 100vw)"
        title={<RequirementDetailTitle code={code} status={status} />}
        closeButtonProps={{ icon: <X size={18} />, "aria-label": "Close requirement details" }}
        overlayProps={{ backgroundOpacity: 0.24, blur: 1 }}
        classNames={{
          content: "project-detail-drawer-content",
          header: "project-detail-drawer-header",
          body: "project-detail-drawer-body"
        }}
      >
        <Stack gap="md">
          <div className="project-detail-list" aria-label="Requirement details">
            <DetailRow label="Requirement" value={code} />
            <DetailRow label="Status" value={status.label} />
            <DetailRow label="Created" value={formatDate(workflow.createdAt)} />
            {workflow.archivedAt ? <DetailRow label="Archived" value={formatDate(workflow.archivedAt)} /> : null}
            <DetailRow label="Issues" value={String(workflow.issues.length)} />
            {planningJob ? <DetailRow label="Planner job" value={`${planningJob.status} - ${formatDate(planningJob.updatedAt)}`} /> : null}
          </div>

          <section className="requirement-detail-section">
            <Text size="xs" fw={780} tt="uppercase" c="dimmed">Full Requirement</Text>
            <Text size="sm" className="requirement-detail-body">{workflow.userRequirement}</Text>
          </section>

          <section className="requirement-detail-section">
            <Text size="xs" fw={780} tt="uppercase" c="dimmed">Issues</Text>
            <Stack gap="xs" mt="xs">
              {workflow.issues.length ? workflow.issues.map((issue) => (
                <div key={issue.issueId} className="requirement-detail-issue">
                  <Group gap="xs" wrap="nowrap" justify="space-between" align="flex-start">
                    <div>
                      <Text size="sm" fw={760}>{issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : issue.issueId}</Text>
                      <Text size="sm" mt={3}>{issue.title}</Text>
                    </div>
                    {issue.prUrl ? <Badge size="xs" variant="light">PR</Badge> : null}
                  </Group>
                  {issue.githubIssueUrl ? <Text component="a" href={issue.githubIssueUrl} size="xs" c="blue" target="_blank" rel="noreferrer">Open GitHub issue</Text> : null}
                </div>
              )) : (
                <Text size="sm" c="dimmed">No issues have been created yet.</Text>
              )}
            </Stack>
          </section>

          {!workflow.archivedAt && workflow.trackingCode ? (
            <section className="project-danger-zone project-detail-danger-zone">
              <Text size="xs" fw={780} c="red">Archive requirement</Text>
              <Text size="xs" c="dimmed">Hide this requirement from the active sidebar list. GitHub issues and PRs are not deleted.</Text>
              <form method="post" action={`/api/projects/${projectId}/requirements/${workflow.workflowId}/archive`}>
                <input type="hidden" name="returnTo" value={`/projects/${projectId}?panel=requirements`} />
                <Button type="submit" variant="light" color="red" size="compact-sm" radius="xl" leftSection={<Archive size={14} />}>
                  Archive
                </Button>
              </form>
            </section>
          ) : null}
        </Stack>
      </Drawer>
    </>
  );
}

function RequirementDetailTitle({ code, status }: { code: string; status: { label: string; color: string } }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <div className="project-detail-title">
        <Text fw={780}>{code}</Text>
        <Text size="xs" c="dimmed">Requirement details</Text>
      </div>
      <Badge variant="light" color={status.color}>{status.label}</Badge>
    </Group>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="project-detail-row">
      <Text size="xs" c="dimmed">{label}</Text>
      <Code className="project-detail-value">{value}</Code>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
