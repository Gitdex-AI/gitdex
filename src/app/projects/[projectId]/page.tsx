import { notFound } from "next/navigation";
import { Alert, Badge, Button, Code, Group, Paper, Stack, Text } from "@mantine/core";
import { Bot, GitBranch, Info, Wrench } from "lucide-react";
import { ProjectAutoRunJob } from "@/components/ProjectAutoRunJob";
import { ProjectChatArea } from "@/components/ProjectChatArea";
import { ProjectHandoffForm } from "@/components/ProjectHandoffForm";
import { ProjectRunJobsForm } from "@/components/ProjectRunJobsForm";
import { ProjectSyncForm } from "@/components/ProjectSyncForm";
import { WorkflowPauseButton } from "@/components/WorkflowPauseButton";
import { findReadyForArchitectPayload } from "@/lib/pm-handoff";
import { getIssueQaStatus } from "@/lib/qa-status";
import { getAgentSession, getProject, listAgentSessions, listJobs, listProjectWorkflows } from "@/lib/store";

export default async function ProjectDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ role?: string; session?: string; error?: string; autorun?: string }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const project = await getProject(projectId);
  if (!project) notFound();

  const activeRole = query.role === "architect" ? "architect" : query.role === "devops" ? "devops" : "product_manager";
  const activeSessionKey = query.session ?? `${project.projectId}:${activeRole}`;
  const [sessions, workflows, jobs, activeSession] = await Promise.all([
    listAgentSessions(project.projectId),
    listProjectWorkflows(project.projectId),
    listJobs(project.projectId),
    getAgentSession(activeSessionKey)
  ]);
  const roleSession = activeSession ?? await getAgentSession(`${project.projectId}:${activeRole}`);
  const isInspectingIssueSession = Boolean(query.session);
  const pmSession = sessions.find((session) => session.sessionKey === `${project.projectId}:product_manager`);
  const allDynamicSessions = sessions.filter((session) => session.role !== "product_manager" && session.role !== "architect" && session.role !== "devops");
  const archivedSessions = allDynamicSessions.filter((session) => session.archivedAt);
  const dynamicSessions = allDynamicSessions.filter((session) => !session.archivedAt);
  const activeWorkflows = workflows.filter((workflow) => workflow.status !== "done");
  const doneWorkflows = workflows.filter((workflow) => workflow.status === "done");
  const readyForArchitectPayload = findReadyForArchitectPayload(pmSession ?? (activeRole === "product_manager" ? roleSession : null));

  return (
    <>
      {query.error && (
        <Alert color="red" icon={<Info size={16} />} mb="md">
          {query.error}
        </Alert>
      )}
      <div className="project-chat-layout">
        <Paper className="chat-panel">
          <div className="chat-header">
            <div>
              <Text fw={820}>{project.name}</Text>
              <Text size="sm" c="dimmed">
                {isInspectingIssueSession ? "Agent context" : "Agent chat"} · {project.githubRepo}
              </Text>
            </div>
            <Group gap="xs">
              <Button component="a" href={`/projects/${project.projectId}?role=product_manager`} variant={!isInspectingIssueSession && activeRole === "product_manager" ? "filled" : "light"} leftSection={<Bot size={16} />}>PM</Button>
              <Button component="a" href={`/projects/${project.projectId}?role=architect`} variant={!isInspectingIssueSession && activeRole === "architect" ? "filled" : "light"} leftSection={<GitBranch size={16} />}>Architect</Button>
              <Button component="a" href={`/projects/${project.projectId}?role=devops`} variant={!isInspectingIssueSession && activeRole === "devops" ? "filled" : "light"} leftSection={<Wrench size={16} />}>DevOps</Button>
            </Group>
          </div>
          <ProjectChatArea projectId={project.projectId} activeRole={activeRole} session={roleSession} readOnly={isInspectingIssueSession} />
        </Paper>

        <aside className="project-context">
          <Paper>
            <Group justify="space-between" p="md" className="section-header">
              <div>
                <Text fw={760}>Project</Text>
                <Text size="sm" c="dimmed">{project.githubRepo}</Text>
              </div>
              <Badge variant="light">{project.autoDeploy ? "auto deploy" : "manual deploy"}</Badge>
            </Group>
            <Stack p="md" gap="xs">
              <Text size="sm">Slug: <Code>{project.slug}</Code></Text>
              <Text size="sm">PM: <Code>{project.projectManagerSessionId ?? "new"}</Code></Text>
              <Text size="sm">Architect: <Code>{project.architectSessionId ?? "new"}</Code></Text>
              <Text size="sm">DevOps: <Code>{project.devopsSessionId ?? "new"}</Code></Text>
              <Text size="sm">Agents: <Code>{project.agentsFilePath}</Code></Text>
              <Text size="sm">Agents update: <Code>{project.updateAgentsFile ? "enabled" : "skipped"}</Code></Text>
            </Stack>
          </Paper>

          <Paper mt="md">
            <Group p="md" className="section-header">
              <div>
                <Text fw={760}>Workflows</Text>
                <Text size="sm" c="dimmed">Issues assigned by architect.</Text>
              </div>
              <Group gap="xs">
                <ProjectRunJobsForm projectId={project.projectId} />
                <ProjectSyncForm projectId={project.projectId} />
              </Group>
            </Group>
            <Stack p="md">
              <ProjectAutoRunJob projectId={project.projectId} enabled={query.autorun === "1"} />
              {!isInspectingIssueSession && <ProjectHandoffForm projectId={project.projectId} payload={readyForArchitectPayload} />}
              {jobs.slice(0, 4).map((job) => (
                <Text key={job.jobId} size="xs" c="dimmed">
                  Job {job.jobId}: {job.type} · {job.status}{job.error ? ` · ${job.error}` : ""}
                </Text>
              ))}
              {activeWorkflows.map((workflow) => (
                <div key={workflow.workflowId} className="workflow-summary-card">
                  <Group justify="space-between" gap="xs">
                    <div>
                      <Text fw={700} size="sm">
                        {workflow.trackingCode ?? workflow.workflowId} · {workflow.paused ? "paused" : workflow.status}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>{workflow.userRequirement}</Text>
                    </div>
                    <Group gap={6}>
                      <Button
                        component="a"
                        href={`/projects/${project.projectId}/workflows/${workflow.workflowId}`}
                        variant="light"
                        size="compact-xs"
                        radius="xl"
                      >
                        Open
                      </Button>
                      <WorkflowPauseButton workflowId={workflow.workflowId} paused={Boolean(workflow.paused)} />
                    </Group>
                  </Group>
                  {workflow.issues.map((issue) => {
                    const qaSession = sessions.find((session) => session.sessionKey === issue.qaSessionId);
                    const qaStatus = getIssueQaStatus(issue, qaSession);
                    return (
                      <Group key={issue.issueId} gap={6} wrap="nowrap">
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {issue.issueId}: {issue.title} · {issue.developerRole ?? issue.assigneeRole}
                          {issue.prState ? ` · PR ${issue.prState}` : ""}
                        </Text>
                        <Badge color={qaStatus.color} size="xs" variant="light">{qaStatus.label}</Badge>
                      </Group>
                    );
                  })}
                </div>
              ))}
              {doneWorkflows.length ? (
                <details className="completed-workflows">
                  <summary>
                    Completed workflows <span>{doneWorkflows.length}</span>
                  </summary>
                  <Stack gap="xs" mt="xs">
                    {doneWorkflows.slice(0, 6).map((workflow) => (
                      <a key={workflow.workflowId} href={`/projects/${project.projectId}/workflows/${workflow.workflowId}`} className="completed-workflow-row">
                        <Group justify="space-between" wrap="nowrap">
                          <Text size="sm" fw={700} lineClamp={1}>{workflow.trackingCode ?? workflow.workflowId}</Text>
                          <Badge size="xs" variant="light">done</Badge>
                        </Group>
                        <Text size="xs" c="dimmed" lineClamp={1}>{workflow.userRequirement}</Text>
                      </a>
                    ))}
                    {doneWorkflows.length > 6 ? (
                      <Text size="xs" c="dimmed">Showing latest 6 completed workflows.</Text>
                    ) : null}
                  </Stack>
                </details>
              ) : null}
              {!activeWorkflows.length && !doneWorkflows.length && <Text c="dimmed" size="sm">No workflows yet.</Text>}
            </Stack>
          </Paper>

          <Paper mt="md">
            <Group justify="space-between" p="md" className="section-header">
              <div>
                <Text fw={760}>Sessions</Text>
                <Text size="sm" c="dimmed">Dynamic developer and QA contexts.</Text>
              </div>
              <Group gap="xs">
                <Badge variant="light">{dynamicSessions.length} active</Badge>
                {archivedSessions.length ? <Badge variant="outline">{archivedSessions.length} archived</Badge> : null}
              </Group>
            </Group>
            <Stack p="md" gap="xs">
              {dynamicSessions.map((session) => (
                <a key={session.sessionKey} href={`/projects/${project.projectId}?session=${encodeURIComponent(session.sessionKey)}`} className="session-row">
                  <Group justify="space-between" align="center" wrap="nowrap">
                    <div>
                      <Text size="sm" fw={720} lineClamp={1}>{session.title}</Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {session.issueId ?? session.role}
                        {session.developerRole ? ` · ${session.developerRole}` : ""}
                        {session.durationMs != null ? ` · ${formatDuration(session.durationMs)}` : ""}
                      </Text>
                    </div>
                    <Badge size="xs" variant="light">{session.status}</Badge>
                  </Group>
                  {session.currentStep ? <Text size="xs" c="dimmed" lineClamp={1}>{session.currentStep}</Text> : null}
                  {session.ownedPaths?.length ? <Text size="xs" c="dimmed" lineClamp={1}>Paths: {session.ownedPaths.join(", ")}</Text> : null}
                </a>
              ))}
              {archivedSessions.slice(0, 3).map((session) => (
                <a key={session.sessionKey} href={`/projects/${project.projectId}?session=${encodeURIComponent(session.sessionKey)}`} className="session-row archived">
                  <Group justify="space-between" align="center" wrap="nowrap">
                    <div>
                      <Text size="sm" fw={720} lineClamp={1}>{session.title}</Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        archived{session.archivedAt ? ` · ${formatDate(session.archivedAt)}` : ""}
                      </Text>
                    </div>
                    <Badge size="xs" variant="outline">{session.status}</Badge>
                  </Group>
                </a>
              ))}
              {!dynamicSessions.length && <Text c="dimmed" size="sm">No dynamic sessions yet.</Text>}
            </Stack>
          </Paper>
        </aside>
      </div>
    </>
  );
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
