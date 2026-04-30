import { notFound } from "next/navigation";
import { Anchor, Badge, Button, Code, Divider, Group, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { ArrowLeft, Bot, CheckCircle2, CircleDot, GitPullRequest, Play, RefreshCw } from "lucide-react";
import { ProjectAutoRunJob } from "@/components/ProjectAutoRunJob";
import { ProjectRunJobsForm } from "@/components/ProjectRunJobsForm";
import { ProjectSyncForm } from "@/components/ProjectSyncForm";
import { WorkflowPauseButton } from "@/components/WorkflowPauseButton";
import { getIssueQaStatus } from "@/lib/qa-status";
import { getProject, getWorkflow, listAgentSessions, listJobs } from "@/lib/store";
import type { AgentSessionRecord, IssueRecord, JobRecord } from "@/lib/types";

export default async function WorkflowDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string; workflowId: string }>;
  searchParams: Promise<{ autorun?: string }>;
}) {
  const [{ projectId, workflowId }, query] = await Promise.all([params, searchParams]);
  const [project, workflow] = await Promise.all([getProject(projectId), getWorkflow(workflowId)]);
  if (!project || !workflow || workflow.projectId !== project.projectId) notFound();

  const [sessions, jobs] = await Promise.all([listAgentSessions(project.projectId), listJobs(project.projectId)]);
  const workflowSessions = sessions.filter((session) => session.workflowId === workflow.workflowId);
  const workflowJobs = jobs.filter((job) => job.payload.workflowId === workflow.workflowId);
  const code = workflow.trackingCode ?? workflow.workflowId;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Button component="a" href={`/projects/${project.projectId}`} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />}>
            Back to project
          </Button>
          <Group gap="sm" mt="sm">
            <Title order={1}>{code}</Title>
            <Badge variant="light">{workflow.paused ? "paused" : workflow.status}</Badge>
          </Group>
          <Text c="dimmed" size="sm">
            {project.name} · {project.githubRepo}
          </Text>
        </div>
        <Group gap="xs">
          <ProjectRunJobsForm projectId={project.projectId} />
          <ProjectSyncForm projectId={project.projectId} />
          <WorkflowPauseButton workflowId={workflow.workflowId} paused={Boolean(workflow.paused)} />
        </Group>
      </Group>

      <div className="workflow-detail-layout">
        <Stack gap="lg">
          <ProjectAutoRunJob
            projectId={project.projectId}
            enabled={query.autorun === "1"}
            redirectTo={`/projects/${project.projectId}/workflows/${workflow.workflowId}`}
          />
          <Paper>
            <Group justify="space-between" p="md" className="section-header">
              <div>
                <Text fw={760}>Requirement</Text>
                <Text size="sm" c="dimmed">Original PM handoff for this workflow.</Text>
              </div>
              <Code>{workflow.workflowId}</Code>
            </Group>
            <Stack p="md">
              <Text>{workflow.userRequirement}</Text>
              <Group gap="xs">
                <Badge variant="outline">{workflow.issues.length} issues</Badge>
                <Badge variant="outline">{workflowSessions.length} sessions</Badge>
                <Badge variant="outline">{workflowJobs.length} jobs</Badge>
                <Badge variant="outline">Created {formatDate(workflow.createdAt)}</Badge>
              </Group>
            </Stack>
          </Paper>

          <Paper>
            <Group justify="space-between" p="md" className="section-header">
              <div>
                <Text fw={760}>Issues And Sessions</Text>
                <Text size="sm" c="dimmed">Developer and QA sessions attached to each issue.</Text>
              </div>
              <Button component="a" href={`/projects/${project.projectId}?role=architect`} variant="light" size="xs" radius="xl" leftSection={<Bot size={14} />}>
                Architect
              </Button>
            </Group>
            <Stack p="md" gap="sm">
              {workflow.issues.map((issue) => (
                <IssueCard key={issue.issueId} projectId={project.projectId} issue={issue} sessions={workflowSessions} />
              ))}
              {!workflow.issues.length && <Text c="dimmed" size="sm">No issues have been planned yet.</Text>}
            </Stack>
          </Paper>
        </Stack>

        <Stack gap="lg">
          <Paper>
            <Group p="md" className="section-header">
              <div>
                <Text fw={760}>Jobs</Text>
                <Text size="sm" c="dimmed">Server-side workflow execution queue.</Text>
              </div>
            </Group>
            <Stack p="md" gap="xs">
              {workflowJobs.map((job) => (
                <JobRow key={job.jobId} job={job} />
              ))}
              {!workflowJobs.length && <Text c="dimmed" size="sm">No jobs for this workflow.</Text>}
            </Stack>
          </Paper>

          <Paper>
            <Group p="md" className="section-header">
              <div>
                <Text fw={760}>Timeline</Text>
                <Text size="sm" c="dimmed">Workflow events recorded by the server.</Text>
              </div>
            </Group>
            <Stack p="md" gap="xs">
              {workflow.timeline.map((event, index) => (
                <Group key={`${event}-${index}`} gap="sm" align="flex-start" wrap="nowrap" className="workflow-timeline-row">
                  <ThemeIcon size={22} radius="xl" variant={index === workflow.timeline.length - 1 ? "filled" : "light"}>
                    {index === workflow.timeline.length - 1 ? <CheckCircle2 size={12} /> : <CircleDot size={10} />}
                  </ThemeIcon>
                  <Text size="sm">{event}</Text>
                </Group>
              ))}
              {!workflow.timeline.length && <Text size="sm" c="dimmed">No timeline events yet.</Text>}
            </Stack>
          </Paper>
        </Stack>
      </div>
    </Stack>
  );
}

function IssueCard({
  projectId,
  issue,
  sessions
}: {
  projectId: string;
  issue: IssueRecord;
  sessions: AgentSessionRecord[];
}) {
  const issueSessions = sessions.filter((session) => session.issueId === issue.issueId);
  const developerSession = issueSessions.find((session) => session.role === "developer");
  const qaSession = issueSessions.find((session) => session.role === "qa");
  const qaStatus = getIssueQaStatus(issue, qaSession);

  return (
    <div className="workflow-issue-card">
      <Group justify="space-between" align="flex-start" gap="sm">
        <div>
          <Group gap="xs">
            <Text fw={760}>{issue.issueId}</Text>
            <Badge size="sm" variant="light">{issue.developerRole ?? issue.assigneeRole}</Badge>
            {issue.prState ? <Badge size="sm" variant="outline">PR {issue.prState}</Badge> : null}
            <Badge size="sm" color={qaStatus.color} variant="light">{qaStatus.label}</Badge>
          </Group>
          <Text fw={700} mt={4}>{issue.title}</Text>
          <Text size="sm" c="dimmed" lineClamp={3}>{issue.description}</Text>
        </div>
        <Stack gap={6} align="flex-end">
          {issue.githubIssueUrl ? <Anchor href={issue.githubIssueUrl} target="_blank" size="xs">GitHub Issue #{issue.githubIssueNumber}</Anchor> : null}
          {issue.prUrl ? (
            <Anchor href={issue.prUrl} target="_blank" size="xs">
              <Group gap={4}><GitPullRequest size={12} /> PR</Group>
            </Anchor>
          ) : null}
        </Stack>
      </Group>

      <Divider my="sm" />
      <Group gap="xs" mb="xs">
        {issue.ownedPaths.map((path) => <Badge key={path} variant="outline" color="gray">{path}</Badge>)}
        {!issue.ownedPaths.length && <Text size="xs" c="dimmed">No owned paths declared.</Text>}
      </Group>

      <div className="workflow-session-grid">
        <SessionLink projectId={projectId} label="Developer" session={developerSession} />
        <SessionLink projectId={projectId} label="QA" session={qaSession} />
      </div>

      {issue.labels?.length ? (
        <Group gap={6} mt="sm">
          {issue.labels.map((label) => <Badge key={label} size="xs" variant="light">{label}</Badge>)}
        </Group>
      ) : null}
    </div>
  );
}

function SessionLink({
  projectId,
  label,
  session
}: {
  projectId: string;
  label: string;
  session?: AgentSessionRecord;
}) {
  if (!session) {
    return (
      <div className="workflow-session-link empty">
        <Text size="xs" c="dimmed">{label}</Text>
        <Text size="sm" fw={700}>Not started</Text>
      </div>
    );
  }

  return (
    <a href={`/projects/${projectId}?session=${encodeURIComponent(session.sessionKey)}`} className="workflow-session-link">
      <Group justify="space-between" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed">{label}</Text>
          <Text size="sm" fw={760} lineClamp={1}>{session.title}</Text>
        </div>
        <Badge size="xs" variant="light">{session.status}</Badge>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={1}>
        {session.currentStep ?? "Open session context"}
      </Text>
      <Text size="xs" c="dimmed">
        {session.durationMs != null ? formatDuration(session.durationMs) : session.startedAt ? `Started ${formatDate(session.startedAt)}` : "Waiting"}
      </Text>
    </a>
  );
}

function JobRow({ job }: { job: JobRecord }) {
  return (
    <div className="workflow-job-row">
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={720}>{job.type}</Text>
        <Badge size="sm" variant="light">{job.status}</Badge>
      </Group>
      <Text size="xs" c="dimmed">Job {job.jobId} · attempts {job.attempts}</Text>
      <Text size="xs" c="dimmed">Updated {formatDate(job.updatedAt)}</Text>
      {job.status === "pending" ? (
        <Group gap={6} mt={6}>
          <ThemeIcon size="xs" variant="light"><Play size={10} /></ThemeIcon>
          <Text size="xs" c="dimmed">Waiting for Run Jobs.</Text>
        </Group>
      ) : null}
      {job.status === "running" ? (
        <Group gap={6} mt={6}>
          <ThemeIcon size="xs" variant="light"><RefreshCw size={10} /></ThemeIcon>
          <Text size="xs" c="dimmed">Agent execution is in progress.</Text>
        </Group>
      ) : null}
      {job.error ? <Text size="xs" c="red" mt={6}>{job.error}</Text> : null}
    </div>
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
