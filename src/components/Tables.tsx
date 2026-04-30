import {
  Badge,
  Code,
  Group,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text
} from "@mantine/core";
import { getWorkflowQaStatus } from "@/lib/qa-status";
import type { ProjectRecord, WorkflowRecord } from "@/lib/types";

export function WorkflowsTable({ workflows }: { workflows: WorkflowRecord[] }) {
  return (
    <TableScrollContainer minWidth={760}>
      <Table highlightOnHover verticalSpacing="sm">
        <TableThead>
          <TableTr>
            <TableTh>ID</TableTh>
            <TableTh>Status</TableTh>
            <TableTh>QA</TableTh>
            <TableTh>Created</TableTh>
            <TableTh>Requirement</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {workflows.length ? (
            workflows.slice(-10).map((workflow) => (
              <WorkflowRow key={workflow.workflowId} workflow={workflow} />
            ))
          ) : (
            <TableTr>
              <TableTd colSpan={5}>
                <Text c="dimmed" ta="center" py="md">
                  No workflows yet.
                </Text>
              </TableTd>
            </TableTr>
          )}
        </TableTbody>
      </Table>
    </TableScrollContainer>
  );
}

function WorkflowRow({ workflow }: { workflow: WorkflowRecord }) {
  const qaStatus = getWorkflowQaStatus(workflow);

  return (
    <TableTr>
      <TableTd>
        <Code>{workflow.trackingCode ?? workflow.workflowId}</Code>
      </TableTd>
      <TableTd>
        <Badge variant="light">{workflow.status}</Badge>
      </TableTd>
      <TableTd>
        <Group gap={6} wrap="nowrap">
          <Badge color={qaStatus.color} variant="light">{qaStatus.label}</Badge>
          {workflow.issues.length ? (
            <Text size="xs" c="dimmed">{workflow.issues.length} issue{workflow.issues.length === 1 ? "" : "s"}</Text>
          ) : null}
        </Group>
      </TableTd>
      <TableTd>
        <Text size="sm" c="dimmed">
          {workflow.createdAt}
        </Text>
      </TableTd>
      <TableTd>
        <Text size="sm" lineClamp={2} maw={520} title={workflow.userRequirement}>
          {workflow.userRequirement}
        </Text>
      </TableTd>
    </TableTr>
  );
}

export function ProjectsTable({ projects }: { projects: ProjectRecord[] }) {
  return (
    <TableScrollContainer minWidth={780}>
      <Table highlightOnHover verticalSpacing="sm">
        <TableThead>
          <TableTr>
            <TableTh>Slug</TableTh>
            <TableTh>Name</TableTh>
            <TableTh>Account</TableTh>
            <TableTh>Repo</TableTh>
            <TableTh>Deploy</TableTh>
            <TableTh>PM Session</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {projects.length ? (
            projects.map((project) => (
              <TableTr key={project.projectId} className="clickable-row">
                <TableTd>
                  <a className="row-link" href={`/projects/${project.projectId}`}>
                    <Code>{project.slug}</Code>
                  </a>
                </TableTd>
                <TableTd>
                  <a className="row-link" href={`/projects/${project.projectId}`}>{project.name}</a>
                </TableTd>
                <TableTd>
                  <a className="row-link" href={`/projects/${project.projectId}`}>{project.githubAccount}</a>
                </TableTd>
                <TableTd>
                  <a className="row-link" href={`/projects/${project.projectId}`}>{project.githubRepo}</a>
                </TableTd>
                <TableTd>
                  <a className="row-link" href={`/projects/${project.projectId}`}>
                    <Badge color={project.autoDeploy ? "green" : "gray"} variant="light">
                      {project.autoDeploy ? "auto" : "manual"}
                    </Badge>
                  </a>
                </TableTd>
                <TableTd>
                  <a className="row-link" href={`/projects/${project.projectId}`}>{project.projectManagerSessionId ?? "new"}</a>
                </TableTd>
              </TableTr>
            ))
          ) : (
            <TableTr>
              <TableTd colSpan={6}>
                <Text c="dimmed" ta="center" py="md">
                  No projects yet.
                </Text>
              </TableTd>
            </TableTr>
          )}
        </TableTbody>
      </Table>
    </TableScrollContainer>
  );
}
