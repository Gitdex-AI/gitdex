import { notFound } from "next/navigation";
import { Alert, Badge, Button, Code, Group, Paper, Stack, Text } from "@mantine/core";
import { AlertCircle, Bot, CheckCircle2, Clock, GitBranch, Info, Play, Wrench } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { ProjectAutoRunJob } from "@/components/ProjectAutoRunJob";
import { ProjectChatArea } from "@/components/ProjectChatArea";
import { ProjectDeleteForm } from "@/components/ProjectDeleteForm";
import { ProjectHandoffForm } from "@/components/ProjectHandoffForm";
import { ProjectRunJobsForm } from "@/components/ProjectRunJobsForm";
import { ProjectSyncForm } from "@/components/ProjectSyncForm";
import { WorkflowPauseButton } from "@/components/WorkflowPauseButton";
import { findReadyForArchitectPayload } from "@/lib/pm-handoff";
import { getIssueQaStatus } from "@/lib/qa-status";
import { getAgentSession, getProject, listAgentSessions, listJobs, listProjectWorkflows } from "@/lib/store";
import { getWorkflowProgress, type WorkflowProgressStep } from "@/lib/workflow-progress";
import { getWorkflowNextAction, type WorkflowNextAction } from "@/lib/workflow-next-action";

export default async function ProjectDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ role?: string; session?: string; error?: string; autorun?: string; workflow?: string; job?: string; queued?: string }>;
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
  const queuedWorkflowId = query.workflow ?? null;
  const queuedJobId = query.job ?? null;
  const queuedWorkflow = queuedWorkflowId ? workflows.find((workflow) => workflow.workflowId === queuedWorkflowId) ?? null : null;
  const queuedJob = queuedJobId ? jobs.find((job) => job.jobId === queuedJobId) ?? null : null;
  const visibleJobs = prioritizeById(jobs, queuedJobId).slice(0, 4);
  const visibleActiveWorkflows = prioritizeById(activeWorkflows, queuedWorkflowId);
  const readyForArchitectPayload = findReadyForArchitectPayload(pmSession ?? (activeRole === "product_manager" ? roleSession : null));
  const nextAction = getWorkflowNextAction(jobs);
  const workflowProgress = getWorkflowProgress({ workflows, jobs });

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
              <div className="project-danger-zone">
                <Text size="xs" fw={780} c="red">Delete local project</Text>
                <Text size="xs" c="dimmed">Type <Code>{project.slug}</Code> to remove this local project and its local Taskix state. GitHub data is not deleted.</Text>
                <ProjectDeleteForm projectId={project.projectId} slug={project.slug} />
              </div>
            </Stack>
          </Paper>

          <Paper mt="md">
            <Group p="md" className="section-header">
              <div>
                <Text fw={760}>Workflows</Text>
                <Text size="sm" c="dimmed">Issues assigned by architect.</Text>
              </div>
              <Group gap="xs">
                <ProjectSyncForm projectId={project.projectId} />
              </Group>
            </Group>
            <Stack p="md">
              <ProjectAutoRunJob projectId={project.projectId} enabled={query.autorun === "1"} />
              {!isInspectingIssueSession && <ProjectHandoffForm projectId={project.projectId} payload={readyForArchitectPayload} />}
              <WorkflowProgressList steps={workflowProgress} />
              <div className="workflow-next-action">
                <Group justify="space-between" gap="sm" align="flex-start">
                  <Group gap="sm" align="flex-start" wrap="nowrap">
                    <div className={`workflow-next-action-icon ${nextAction.tone}`}>
                      {renderWorkflowNextActionIcon(nextAction)}
                    </div>
                    <div>
                      <Group gap="xs">
                        <Text fw={760}>{nextAction.title}</Text>
                        <Badge size="xs" variant="light">{nextAction.phase}</Badge>
                      </Group>
                      <Text size="sm" c="dimmed" mt={4}>{nextAction.description}</Text>
                      <Group gap={6} mt="xs">
                        <Badge size="xs" variant="outline">{nextAction.planningPending} planning pending</Badge>
                        <Badge size="xs" variant="outline">{nextAction.developerPending} developer pending</Badge>
                        {nextAction.runningCount ? <Badge size="xs" color="blue" variant="light">{nextAction.runningCount} running</Badge> : null}
                        {nextAction.failedCount ? <Badge size="xs" color="red" variant="light">{nextAction.failedCount} blocked</Badge> : null}
                      </Group>
                    </div>
                  </Group>
                  {nextAction.buttonLabel ? (
                    <ProjectRunJobsForm projectId={project.projectId} label={nextAction.buttonLabel} />
                  ) : (
                    <Button type="button" variant="light" size="xs" radius="xl" disabled leftSection={<Play size={14} />}>
                      {nextAction.disabledLabel}
                    </Button>
                  )}
                </Group>
              </div>
              {query.queued === "1" && queuedWorkflow ? (
                <Alert icon={<GitBranch size={16} />} color="blue" variant="light">
                  <Text size="sm" fw={700}>Workflow queued for architect planning</Text>
                  <Text size="xs" c="dimmed">
                    {queuedWorkflow.trackingCode ?? queuedWorkflow.workflowId} is waiting in the workflow area below.
                    {queuedJob ? ` Pending job: ${queuedJob.type} (${queuedJob.status}).` : ""}
                  </Text>
                </Alert>
              ) : null}
              {visibleJobs.map((job) => (
                <div
                  key={job.jobId}
                  className="workflow-job-row"
                  style={job.jobId === queuedJobId ? highlightedCardStyle : undefined}
                >
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Text size="sm" fw={700}>{job.type}</Text>
                    <Badge size="xs" variant="light">{job.status}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mt={4}>
                    Job {job.jobId}
                    {job.payload.workflowId ? ` · workflow ${job.payload.workflowId}` : ""}
                    {job.error ? ` · ${job.error}` : ""}
                  </Text>
                </div>
              ))}
              {!visibleJobs.length ? <Text c="dimmed" size="sm">No queued jobs yet.</Text> : null}
              {visibleActiveWorkflows.map((workflow) => (
                <div
                  key={workflow.workflowId}
                  className="workflow-summary-card"
                  style={workflow.workflowId === queuedWorkflowId ? highlightedCardStyle : undefined}
                >
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

function prioritizeById<T extends { workflowId?: string; jobId?: string }>(items: T[], selectedId: string | null): T[] {
  if (!selectedId) return items;
  return [...items].sort((left, right) => {
    const leftSelected = left.workflowId === selectedId || left.jobId === selectedId;
    const rightSelected = right.workflowId === selectedId || right.jobId === selectedId;
    if (leftSelected === rightSelected) return 0;
    return leftSelected ? -1 : 1;
  });
}

const highlightedCardStyle = {
  borderColor: "#93c5fd",
  background: "#eff6ff"
} satisfies CSSProperties;

function renderWorkflowNextActionIcon(action: WorkflowNextAction): ReactNode {
  switch (action.icon) {
    case "clock":
      return <Clock size={18} />;
    case "play":
      return <Play size={18} />;
    case "git-branch":
      return <GitBranch size={18} />;
    case "alert":
      return <AlertCircle size={18} />;
    case "check":
      return <CheckCircle2 size={18} />;
  }
}

function WorkflowProgressList({ steps }: { steps: WorkflowProgressStep[] }) {
  return (
    <div className="workflow-progress">
      <Group justify="space-between" gap="xs" mb="xs">
        <Text fw={760}>Current workflow step</Text>
        <Badge size="xs" variant="light">{steps.find((step) => step.status === "current" || step.status === "blocked")?.label ?? "Workflow"}</Badge>
      </Group>
      <Stack gap={0}>
        {steps.map((step) => (
          <div key={step.id} className={`workflow-progress-step ${step.status}`}>
            <div className="workflow-progress-marker" aria-hidden="true" />
            <div className="workflow-progress-copy">
              <Group gap="xs" justify="space-between" align="flex-start">
                <Text size="sm" fw={760}>{step.label}</Text>
                <Badge size="xs" color={workflowProgressStatusColor(step.status)} variant={step.status === "upcoming" ? "outline" : "light"}>
                  {workflowProgressStatusLabel(step.status)}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" mt={2}>{step.detail}</Text>
            </div>
          </div>
        ))}
      </Stack>
    </div>
  );
}

function workflowProgressStatusLabel(status: WorkflowProgressStep["status"]): string {
  switch (status) {
    case "complete":
      return "Done";
    case "current":
      return "Current";
    case "blocked":
      return "Blocked";
    case "upcoming":
      return "Next";
  }
}

function workflowProgressStatusColor(status: WorkflowProgressStep["status"]): string {
  switch (status) {
    case "complete":
      return "green";
    case "current":
      return "blue";
    case "blocked":
      return "red";
    case "upcoming":
      return "gray";
  }
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
