"use client";

import { Badge, Button, Code, Drawer, Group, Stack, Text } from "@mantine/core";
import { Info, X } from "lucide-react";
import { useState } from "react";
import { ProjectDeleteForm } from "@/components/ProjectDeleteForm";

export function ProjectDetailPanel({
  project
}: {
  project: {
    projectId: string;
    slug: string;
    githubRepo: string;
    autoDeploy: boolean;
    agentsFilePath: string;
    updateAgentsFile: boolean;
    projectManagerSessionId?: string | null;
    devopsSessionId?: string | null;
  };
}) {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="light"
        size="xs"
        radius="xl"
        leftSection={<Info size={14} />}
        onClick={() => setOpened(true)}
      >
        Project details
      </Button>
      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        position="right"
        size="min(460px, 100vw)"
        title={<ProjectDetailPanelTitle repo={project.githubRepo} autoDeploy={project.autoDeploy} />}
        closeButtonProps={{ icon: <X size={18} />, "aria-label": "Close project details" }}
        overlayProps={{ backgroundOpacity: 0.24, blur: 1 }}
        classNames={{
          content: "project-detail-drawer-content",
          header: "project-detail-drawer-header",
          body: "project-detail-drawer-body"
        }}
      >
        <Stack gap="md">
          <div className="project-detail-list" aria-label="Project details">
            <ProjectDetailRow label="GitHub repo" value={project.githubRepo} />
            <ProjectDetailRow label="Deploy mode" value={project.autoDeploy ? "Automatic" : "Manual"} />
            <ProjectDetailRow label="Slug" value={project.slug} />
            <ProjectDetailRow label="PM session" value={project.projectManagerSessionId ?? "new"} />
            <ProjectDetailRow label="DevOps session" value={project.devopsSessionId ?? "new"} />
            <ProjectDetailRow label="Agents file path" value={project.agentsFilePath} />
            <ProjectDetailRow label="Agents update setting" value={project.updateAgentsFile ? "enabled" : "skipped"} />
          </div>

          <div className="project-danger-zone project-detail-danger-zone">
            <Text size="xs" fw={780} c="red">Delete local project</Text>
            <Text size="xs" c="dimmed">
              Type <Code>{project.slug}</Code> to remove this local project and its local Gitdex state. GitHub data is not deleted.
            </Text>
            <ProjectDeleteForm projectId={project.projectId} slug={project.slug} />
          </div>
        </Stack>
      </Drawer>
    </>
  );
}

function ProjectDetailPanelTitle({ repo, autoDeploy }: { repo: string; autoDeploy: boolean }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <div className="project-detail-title">
        <Text fw={780}>Project</Text>
        <Text size="xs" c="dimmed" lineClamp={1}>{repo}</Text>
      </div>
      <Badge variant="light">{autoDeploy ? "auto deploy" : "manual deploy"}</Badge>
    </Group>
  );
}

function ProjectDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="project-detail-row">
      <Text size="xs" c="dimmed">{label}</Text>
      <Code className="project-detail-value">{value}</Code>
    </div>
  );
}
