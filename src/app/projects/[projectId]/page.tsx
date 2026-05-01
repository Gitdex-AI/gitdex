import { notFound } from "next/navigation";
import { Alert, Badge, Button, Code, Group, Paper, Stack, Text } from "@mantine/core";
import { Bot, GitBranch, Info, ListTodo, RefreshCw, RotateCcw } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { ProjectAutoRunJob } from "@/components/ProjectAutoRunJob";
import { ProjectChatArea } from "@/components/ProjectChatArea";
import { ProjectDeleteForm } from "@/components/ProjectDeleteForm";
import { ProjectHandoffForm } from "@/components/ProjectHandoffForm";
import { ProjectMergePrButton } from "@/components/ProjectMergePrButton";
import { ProjectRetryJobButton } from "@/components/ProjectRetryJobButton";
import { ProjectRunJobsForm } from "@/components/ProjectRunJobsForm";
import { ProjectSyncForm } from "@/components/ProjectSyncForm";
import { WorkflowPauseButton } from "@/components/WorkflowPauseButton";
import { findReadyForArchitectPayload } from "@/lib/pm-handoff";
import { getIssueQaStatus } from "@/lib/qa-status";
import { getAgentSession, getProject, listAgentSessions, listJobs, listProjectWorkflows } from "@/lib/store";
import type { AgentSessionRecord, IssueRecord, JobRecord, WorkflowRecord } from "@/lib/types";
import { getWorkflowProgress, type WorkflowProgressStep } from "@/lib/workflow-progress";

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
  const sortedWorkflows = sortWorkflowsLatestFirst(workflows);
  const activeWorkflows = sortedWorkflows.filter((workflow) => workflow.status !== "done");
  const doneWorkflows = sortedWorkflows.filter((workflow) => workflow.status === "done");
  const queuedWorkflowId = query.workflow ?? null;
  const queuedJobId = query.job ?? null;
  const queuedWorkflow = queuedWorkflowId ? sortedWorkflows.find((workflow) => workflow.workflowId === queuedWorkflowId) ?? null : null;
  const queuedJob = queuedJobId ? jobs.find((job) => job.jobId === queuedJobId) ?? null : null;
  const visibleActiveWorkflows = prioritizeById(activeWorkflows, queuedWorkflowId);
  const latestWorkflow = queuedWorkflow ?? visibleActiveWorkflows[0] ?? sortedWorkflows[0] ?? null;
  const workflowPanelWorkflows = latestWorkflow ? [latestWorkflow] : [];
  const workflowPanelJobs = filterJobsForWorkflows(jobs, workflowPanelWorkflows);
  const workflowPanelSessions = filterSessionsForWorkflows(sessions, workflowPanelWorkflows);
  const workflowPanelDynamicSessions = workflowPanelSessions.filter((session) => session.role !== "product_manager" && session.role !== "architect" && session.role !== "devops" && !session.archivedAt);
  const workflowPanelArchivedSessions = workflowPanelSessions.filter((session) => session.role !== "product_manager" && session.role !== "architect" && session.role !== "devops" && session.archivedAt);
  const readyForArchitectPayload = findReadyForArchitectPayload(pmSession ?? (activeRole === "product_manager" ? roleSession : null));
  const workflowProgress = getWorkflowProgress({ workflows: workflowPanelWorkflows, jobs: workflowPanelJobs });
  const workflowStepDetails = buildWorkflowStepDetails({
    projectId: project.projectId,
    isInspectingIssueSession,
    readyForArchitectPayload,
    pmSession,
    sessions: workflowPanelSessions,
    dynamicSessions: workflowPanelDynamicSessions,
    archivedSessions: workflowPanelArchivedSessions,
    jobs: workflowPanelJobs,
    activeWorkflows: workflowPanelWorkflows,
    visibleActiveWorkflows: workflowPanelWorkflows,
    queuedWorkflow,
    queuedJob,
    queuedJobId
  });

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
              <Badge variant="light" leftSection={<Bot size={12} />}>All agents</Badge>
              {isInspectingIssueSession ? <Badge variant="outline">Read-only session</Badge> : null}
            </Group>
          </div>
          <ProjectChatArea projectId={project.projectId} sessions={sessions} inspectedSession={activeSession} readOnly={isInspectingIssueSession} />
        </Paper>

        <aside className="project-context">
          <Paper>
            <Group p="md" className="section-header">
              <div>
                <Text fw={760}>Workflows</Text>
                <Text size="sm" c="dimmed">Current project delivery flow.</Text>
              </div>
              <Group gap="xs">
                <Button
                  component="a"
                  href={`/projects/${project.projectId}/github-triage`}
                  variant="light"
                  size="xs"
                  radius="xl"
                  leftSection={<ListTodo size={14} />}
                >
                  GitHub triage
                </Button>
                <ProjectSyncForm projectId={project.projectId} />
              </Group>
            </Group>
            <Stack p="md">
              <ProjectAutoRunJob projectId={project.projectId} enabled={query.autorun === "1"} />
              <WorkflowProgressList
                steps={workflowProgress}
                projectId={project.projectId}
                workflows={workflowPanelWorkflows}
                stepDetails={workflowStepDetails}
              />
              <CompletedWorkflowHistory projectId={project.projectId} workflows={doneWorkflows} />
            </Stack>
          </Paper>

          <Paper mt="md">
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
        </aside>
      </div>
    </>
  );
}

function sortWorkflowsLatestFirst(workflows: WorkflowRecord[]): WorkflowRecord[] {
  return [...workflows].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
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

function filterJobsForWorkflows(jobs: JobRecord[], workflows: WorkflowRecord[]): JobRecord[] {
  const workflowIds = new Set(workflows.map((workflow) => workflow.workflowId));
  if (!workflowIds.size) return [];
  return jobs.filter((job) => workflowIds.has(job.payload.workflowId));
}

function filterSessionsForWorkflows(sessions: AgentSessionRecord[], workflows: WorkflowRecord[]): AgentSessionRecord[] {
  const workflowIds = new Set(workflows.map((workflow) => workflow.workflowId));
  const issueSessionIds = new Set(
    workflows.flatMap((workflow) => workflow.issues.flatMap((issue) => [issue.issueId, issue.developerSessionId, issue.qaSessionId].filter(Boolean) as string[]))
  );
  if (!workflowIds.size) return sessions.filter((session) => session.role === "product_manager" || session.role === "architect" || session.role === "devops");

  return sessions.filter((session) => {
    if (session.role === "product_manager" || session.role === "architect" || session.role === "devops") return true;
    if (session.workflowId && workflowIds.has(session.workflowId)) return true;
    if (session.issueId && issueSessionIds.has(session.issueId)) return true;
    return issueSessionIds.has(session.sessionKey);
  });
}

const highlightedCardStyle = {
  borderColor: "#93c5fd",
  background: "#eff6ff"
} satisfies CSSProperties;

type ProjectHandoffPayload = ComponentProps<typeof ProjectHandoffForm>["payload"];

function buildWorkflowStepDetails(input: {
  projectId: string;
  isInspectingIssueSession: boolean;
  readyForArchitectPayload: ProjectHandoffPayload;
  pmSession: AgentSessionRecord | undefined;
  sessions: AgentSessionRecord[];
  dynamicSessions: AgentSessionRecord[];
  archivedSessions: AgentSessionRecord[];
  jobs: JobRecord[];
  activeWorkflows: WorkflowRecord[];
  visibleActiveWorkflows: WorkflowRecord[];
  queuedWorkflow: WorkflowRecord | null;
  queuedJob: JobRecord | null;
  queuedJobId: string | null;
}): Record<WorkflowProgressStep["id"], ReactNode> {
  const developerSessions = input.dynamicSessions.filter((session) => session.role === "developer");
  const qaSessions = input.dynamicSessions.filter((session) => session.role === "qa");
  const planningJobs = input.jobs.filter((job) => job.type === "workflow_run");
  const developerJobs = input.jobs.filter((job) => job.type === "issue_run");

  return {
    requirement: (
      <Stack gap="xs">
        <Text size="xs" c="dimmed">PM chat is the source of the requirement before it becomes planned work.</Text>
        {input.pmSession ? <SessionLink session={input.pmSession} /> : <Text size="xs" c="dimmed">No PM session has been recorded yet.</Text>}
        {!input.isInspectingIssueSession ? <ProjectHandoffForm projectId={input.projectId} payload={input.readyForArchitectPayload} /> : null}
      </Stack>
    ),
    planning: (
      <Stack gap="xs">
        {renderStepRecovery({
          projectId: input.projectId,
          title: "Recover architect planning",
          reason: recoveryReasonForJobs(planningJobs),
          jobs: planningJobs,
          sessions: input.sessions.filter((session) => session.role === "architect"),
          syncLabel: "Sync planning state"
        })}
        {input.queuedWorkflow ? (
          <Alert icon={<GitBranch size={16} />} color="blue" variant="light">
            <Text size="sm" fw={700}>Workflow queued for architect planning</Text>
            <Text size="xs" c="dimmed">
              {input.queuedWorkflow.trackingCode ?? input.queuedWorkflow.workflowId} is waiting for the planning step.
              {input.queuedJob ? ` Pending job: ${input.queuedJob.type} (${input.queuedJob.status}).` : ""}
            </Text>
          </Alert>
        ) : null}
        {renderStepRunAction(input.projectId, input.jobs, "workflow_run", "Run Architect Planning")}
        {renderJobRows(input.projectId, planningJobs, input.queuedJobId)}
        {renderSessionRows(input.sessions.filter((session) => session.role === "architect"))}
      </Stack>
    ),
    developer: (
      <Stack gap="xs">
        {renderStepRecovery({
          projectId: input.projectId,
          title: "Recover developer PR",
          reason: recoveryReasonForDeveloperStep(input.visibleActiveWorkflows, developerJobs, developerSessions),
          jobs: developerJobs,
          sessions: developerSessions,
          syncLabel: "Recover PR from GitHub"
        })}
        {renderStepRunAction(input.projectId, input.jobs, "issue_run", "Run Developer Jobs")}
        {renderJobRows(input.projectId, developerJobs, input.queuedJobId)}
        {renderDeveloperIssueRows(input.visibleActiveWorkflows, input.sessions)}
        {renderSessionRows(developerSessions)}
      </Stack>
    ),
    qa: (
      <Stack gap="xs">
        {renderStepRecovery({
          projectId: input.projectId,
          title: "Recover QA validation",
          reason: recoveryReasonForQaStep(input.activeWorkflows, qaSessions),
          jobs: [],
          sessions: qaSessions,
          syncLabel: "Sync QA labels"
        })}
        {renderQaIssueRows(input.activeWorkflows, input.sessions)}
        {renderSessionRows(qaSessions)}
      </Stack>
    ),
    merge: (
      <Stack gap="xs">
        {renderStepRecovery({
          projectId: input.projectId,
          title: "Recover merge readiness",
          reason: recoveryReasonForMergeStep(input.activeWorkflows),
          jobs: [],
          sessions: [],
          syncLabel: "Sync merge state"
        })}
        {renderMergeIssueRows(input.projectId, input.activeWorkflows)}
      </Stack>
    ),
    done: (
      <Stack gap="xs">
        {renderSessionRows(input.archivedSessions.slice(0, 4), true)}
      </Stack>
    )
  };
}

function renderStepRecovery(input: {
  projectId: string;
  title: string;
  reason: string | null;
  jobs: JobRecord[];
  sessions: AgentSessionRecord[];
  syncLabel: string;
}): ReactNode {
  if (!input.reason) return null;
  const failedJobs = input.jobs.filter((job) => job.status === "failed");
  const blockedSessions = input.sessions.filter((session) => session.status === "blocked");

  return (
    <div className="workflow-recovery-panel">
      <Group justify="space-between" gap="sm" align="flex-start">
        <div>
          <Group gap={6}>
            <RefreshCw size={14} />
            <Text size="sm" fw={780}>{input.title}</Text>
          </Group>
          <Text size="xs" c="dimmed" mt={3}>{input.reason}</Text>
        </div>
        <ProjectSyncForm projectId={input.projectId} label={input.syncLabel} compact />
      </Group>
      {failedJobs.length || blockedSessions.length ? (
        <Group gap={6} mt="xs">
          {failedJobs.map((job) => <ProjectRetryJobButton key={job.jobId} projectId={input.projectId} jobId={job.jobId} />)}
          {blockedSessions.map((session) => (
            <Button
              key={session.sessionKey}
              component="a"
              href={`/projects/${input.projectId}?session=${encodeURIComponent(session.sessionKey)}`}
              variant="light"
              color="red"
              size="compact-xs"
              radius="xl"
              leftSection={<RotateCcw size={14} />}
            >
              Open blocked session
            </Button>
          ))}
        </Group>
      ) : null}
    </div>
  );
}

function recoveryReasonForJobs(jobs: JobRecord[]): string | null {
  if (jobs.some((job) => job.status === "failed")) return "A planning job failed. Retry the failed job, or sync GitHub if issues were created before the failure.";
  if (jobs.some((job) => job.status === "running")) return "Planning is running. If the status does not change after several minutes, sync state or retry after it is marked failed.";
  return null;
}

function recoveryReasonForDeveloperStep(workflows: WorkflowRecord[], jobs: JobRecord[], sessions: AgentSessionRecord[]): string | null {
  if (jobs.some((job) => job.status === "failed")) return "A developer job failed. Retry the failed job; if a branch or PR was already created, recover it from GitHub first.";
  if (sessions.some((session) => session.status === "blocked")) return "A developer session is blocked. Open the session for the blocker details, then retry or recover the PR from GitHub.";
  const issues = workflows.flatMap((workflow) => workflow.issues);
  if (issues.some((issue) => issue.branch && !issue.prUrl)) return "Developer work has a branch but no recorded PR. Use GitHub sync to recover a PR that was created or finish PR creation manually.";
  if (issues.some((issue) => hasAnyLabel(issue, ["taskix:dev-running"]) && !issue.prUrl)) return "Developer work is marked running without a PR. Sync GitHub to detect a partially completed PR, or retry the developer job.";
  return null;
}

function recoveryReasonForQaStep(workflows: WorkflowRecord[], sessions: AgentSessionRecord[]): string | null {
  if (sessions.some((session) => session.status === "blocked")) return "QA is blocked or failed. Open the QA session for findings, then retry the developer fix path after the issue is updated.";
  const issues = workflows.flatMap((workflow) => workflow.issues);
  if (issues.some((issue) => (issue.prUrl || issue.prState?.toUpperCase() === "OPEN") && !hasAnyLabel(issue, ["taskix:need-qa", "taskix:qa-running", "qa-passed", "taskix:qa-passed", "qa-failed", "taskix:qa-failed", "taskix:ready-to-merge"]))) {
    return "A PR is open but QA labels are missing. Sync GitHub to recover labels, or request QA before this workflow can move forward.";
  }
  if (issues.some((issue) => issue.prUrl && hasAnyLabel(issue, ["taskix:need-qa", "taskix:qa-running"]))) {
    return "A PR is waiting on QA labels. After QA finishes, sync GitHub so Taskix can move the workflow to pass/fail or merge readiness.";
  }
  return null;
}

function recoveryReasonForMergeStep(workflows: WorkflowRecord[]): string | null {
  const issues = workflows.flatMap((workflow) => workflow.issues);
  if (issues.some((issue) => hasAnyLabel(issue, ["qa-passed", "taskix:qa-passed", "taskix:ready-to-merge"]) && issue.prState !== "MERGED")) {
    return "QA has passed and the PR is ready. Merge from this step, then sync GitHub if the issue or PR state does not update.";
  }
  return null;
}

function renderStepRunAction(projectId: string, jobs: JobRecord[], jobType: JobRecord["type"], label: string): ReactNode {
  const pendingCount = jobs.filter((job) => job.type === jobType && job.status === "pending").length;
  if (!pendingCount) return null;
  return (
    <div className="workflow-step-action">
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <div>
          <Text size="sm" fw={760}>{label}</Text>
          <Text size="xs" c="dimmed">
            {pendingCount} pending {jobType === "workflow_run" ? "planning" : "developer"} job{pendingCount === 1 ? "" : "s"} for this step.
          </Text>
        </div>
        <ProjectRunJobsForm projectId={projectId} label={label} />
      </Group>
    </div>
  );
}

function CompletedWorkflowHistory({ projectId, workflows }: { projectId: string; workflows: WorkflowRecord[] }) {
  if (!workflows.length) return null;
  return (
    <details className="completed-workflows">
      <summary>
        <span>Completed workflow history</span>
        <Badge size="xs" variant="light">{workflows.length}</Badge>
      </summary>
      <Stack gap="xs" mt="sm">
        {renderCompletedWorkflowRows(projectId, workflows)}
      </Stack>
    </details>
  );
}

function renderWorkflowActionRows(projectId: string, workflows: WorkflowRecord[]): ReactNode {
  if (!workflows.length) return <Text size="xs" c="dimmed">No workflow entries for this project yet.</Text>;
  return workflows.map((workflow) => (
    <div key={workflow.workflowId} className="workflow-control-row">
      <div>
        <Text size="sm" fw={760} lineClamp={1}>{workflow.trackingCode ?? workflow.workflowId}</Text>
        <Text size="xs" c="dimmed" lineClamp={1}>{workflow.userRequirement}</Text>
      </div>
      <Group gap={6} wrap="nowrap">
        <Button
          component="a"
          href={`/projects/${projectId}/workflows/${workflow.workflowId}`}
          variant="light"
          size="compact-xs"
          radius="xl"
        >
          Open
        </Button>
        {workflow.status !== "done" ? <WorkflowPauseButton workflowId={workflow.workflowId} paused={Boolean(workflow.paused)} /> : null}
      </Group>
    </div>
  ));
}

function renderJobRows(projectId: string, jobs: JobRecord[], queuedJobId: string | null): ReactNode {
  if (!jobs.length) return <Text size="xs" c="dimmed">No jobs recorded for this step.</Text>;
  return jobs.slice(0, 4).map((job) => (
    <div
      key={job.jobId}
      className="workflow-job-row"
      style={job.jobId === queuedJobId ? highlightedCardStyle : undefined}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm" fw={700}>{job.type}</Text>
        <Group gap={6} wrap="nowrap">
          <Badge size="xs" color={job.status === "failed" ? "red" : undefined} variant="light">{job.status}</Badge>
          {job.status === "failed" ? <ProjectRetryJobButton projectId={projectId} jobId={job.jobId} /> : null}
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        Job {job.jobId}
        {job.payload.workflowId ? ` · workflow ${job.payload.workflowId}` : ""}
        {job.runtime?.lastHeartbeatAt ? ` · last heartbeat ${formatDate(job.runtime.lastHeartbeatAt)}` : ""}
        {job.error ? ` · ${job.error}` : ""}
      </Text>
    </div>
  ));
}

function renderDeveloperIssueRows(workflows: WorkflowRecord[], sessions: AgentSessionRecord[]): ReactNode {
  const issues = workflows.flatMap((workflow) => workflow.issues);
  if (!issues.length) return <Text size="xs" c="dimmed">No developer issues planned yet.</Text>;
  return issues.map((issue) => {
    const qaSession = sessions.find((session) => session.sessionKey === issue.qaSessionId);
    const qaStatus = getIssueQaStatus(issue, qaSession);
    return <IssueStatusRow key={issue.issueId} issue={issue} qaStatus={qaStatus} />;
  });
}

function renderQaIssueRows(workflows: WorkflowRecord[], sessions: AgentSessionRecord[]): ReactNode {
  const issues = workflows.flatMap((workflow) => workflow.issues).filter((issue) => issue.prUrl || issue.prState || issue.qaSessionId);
  if (!issues.length) return <Text size="xs" c="dimmed">No QA-ready issues yet.</Text>;
  return issues.map((issue) => {
    const qaSession = sessions.find((session) => session.sessionKey === issue.qaSessionId);
    return <IssueStatusRow key={issue.issueId} issue={issue} qaStatus={getIssueQaStatus(issue, qaSession)} />;
  });
}

function renderMergeIssueRows(projectId: string, workflows: WorkflowRecord[]): ReactNode {
  const issues = workflows.flatMap((workflow) => workflow.issues).filter((issue) => hasAnyLabel(issue, ["qa-passed", "taskix:qa-passed", "taskix:ready-to-merge"]));
  if (!issues.length) return <Text size="xs" c="dimmed">No QA-passed or ready-to-merge issues yet.</Text>;
  return issues.map((issue) => (
    <div key={issue.issueId} className="workflow-job-row">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={700} lineClamp={1}>{issue.title}</Text>
          <Text size="xs" c="dimmed" mt={4}>
            {issue.githubIssueNumber ? `Issue #${issue.githubIssueNumber}` : issue.issueId}
            {issue.prState ? ` · PR ${issue.prState}` : ""}
          </Text>
        </div>
        <Group gap={6} wrap="nowrap">
          <Badge size="xs" color="green" variant="light">ready</Badge>
          {issue.prUrl && issue.prState !== "MERGED" ? <ProjectMergePrButton projectId={projectId} issueId={issue.issueId} /> : null}
        </Group>
      </Group>
    </div>
  ));
}

function renderCompletedWorkflowRows(projectId: string, workflows: WorkflowRecord[]): ReactNode {
  if (!workflows.length) return <Text size="xs" c="dimmed">No completed workflows yet.</Text>;
  return workflows.slice(0, 6).map((workflow) => (
    <a key={workflow.workflowId} href={`/projects/${projectId}/workflows/${workflow.workflowId}`} className="completed-workflow-row">
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={700} lineClamp={1}>{workflow.trackingCode ?? workflow.workflowId}</Text>
        <Badge size="xs" variant="light">done</Badge>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={1}>{workflow.userRequirement}</Text>
    </a>
  ));
}

function renderSessionRows(sessions: AgentSessionRecord[], archived = false): ReactNode {
  if (!sessions.length) return <Text size="xs" c="dimmed">No sessions recorded for this step.</Text>;
  return sessions.map((session) => <SessionLink key={session.sessionKey} session={session} archived={archived || Boolean(session.archivedAt)} />);
}

function IssueStatusRow({ issue, qaStatus }: { issue: IssueRecord; qaStatus: ReturnType<typeof getIssueQaStatus> }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed" lineClamp={1}>
        {issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : issue.issueId}: {issue.title}
        {issue.prState ? ` · PR ${issue.prState}` : ""}
      </Text>
      <Badge color={qaStatus.color} size="xs" variant="light">{qaStatus.label}</Badge>
    </Group>
  );
}

function SessionLink({ session, archived = false }: { session: AgentSessionRecord; archived?: boolean }) {
  return (
    <a href={`/projects/${session.projectId}?session=${encodeURIComponent(session.sessionKey)}`} className={`session-row${archived ? " archived" : ""}`}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <div>
          <Text size="sm" fw={720} lineClamp={1}>{session.title}</Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {archived ? "archived" : session.issueId ?? session.role}
            {session.developerRole ? ` · ${session.developerRole}` : ""}
            {session.durationMs != null ? ` · ${formatDuration(session.durationMs)}` : ""}
            {archived && session.archivedAt ? ` · ${formatDate(session.archivedAt)}` : ""}
          </Text>
        </div>
        <Badge size="xs" variant={archived ? "outline" : "light"}>{session.status}</Badge>
      </Group>
      {session.currentStep ? <Text size="xs" c="dimmed" lineClamp={1}>{session.currentStep}</Text> : null}
      {session.ownedPaths?.length ? <Text size="xs" c="dimmed" lineClamp={1}>Paths: {session.ownedPaths.join(", ")}</Text> : null}
    </a>
  );
}

function hasAnyLabel(issue: IssueRecord, expected: string[]): boolean {
  const labels = new Set([...(issue.labels ?? []), ...(issue.prLabels ?? [])].map((label) => label.toLowerCase()));
  return expected.some((label) => labels.has(label));
}

function WorkflowProgressList({
  steps,
  projectId,
  workflows,
  stepDetails
}: {
  steps: WorkflowProgressStep[];
  projectId: string;
  workflows: WorkflowRecord[];
  stepDetails: Record<WorkflowProgressStep["id"], ReactNode>;
}) {
  const activeIndex = getActiveWorkflowStepIndex(steps);
  const activeStep = steps[activeIndex];

  return (
    <div className="workflow-progress">
      <div className={`workflow-progress-summary ${activeStep.status}`}>
        <Text size="xs" fw={800} tt="uppercase" c="dimmed">Workflow progress</Text>
        <Group justify="space-between" gap="xs" align="flex-start" mt={4}>
          <div>
            <Text fw={840}>Step {activeIndex + 1} of {steps.length}</Text>
            <Text size="sm" c="dimmed">{activeStep.label.replace(/^\d+\.\s*/, "")}</Text>
          </div>
          <Stack gap={6} align="flex-end">
            <Badge color={workflowProgressStatusColor(activeStep.status)} variant="light">
              {workflowProgressStatusLabel(activeStep.status)}
            </Badge>
          </Stack>
        </Group>
      </div>
      {workflows.length ? (
        <div className="workflow-progress-controls">
          <Text size="xs" fw={800} tt="uppercase" c="dimmed">Workflow entries</Text>
          <Stack gap="xs" mt="xs">
            {renderWorkflowActionRows(projectId, workflows)}
          </Stack>
        </div>
      ) : null}

      <Stack gap={0} mt="sm">
        {steps.map((step, index) => (
          <div key={step.id} className={`workflow-progress-step ${step.status}`}>
            <div className="workflow-progress-marker" aria-label={`Step ${index + 1}`}>
              {index + 1}
            </div>
            <div className="workflow-progress-copy">
              <Group gap="xs" justify="space-between" align="flex-start">
                <Text size="sm" fw={step.status === "current" || step.status === "running" || step.status === "blocked" ? 850 : 760}>{step.label}</Text>
                <Badge size="xs" color={workflowProgressStatusColor(step.status)} variant={step.status === "upcoming" ? "outline" : "light"}>
                  {workflowProgressStatusLabel(step.status)}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" mt={2}>{step.detail}</Text>
              <details className="workflow-progress-detail" open={step.status === "current" || step.status === "running" || step.status === "blocked"}>
                <summary>View step details</summary>
                <div className="workflow-progress-detail-body">
                  {stepDetails[step.id]}
                </div>
              </details>
            </div>
          </div>
        ))}
      </Stack>
    </div>
  );
}

function getActiveWorkflowStepIndex(steps: WorkflowProgressStep[]): number {
  const activeIndex = steps.findIndex((step) => step.status === "current" || step.status === "running" || step.status === "blocked");
  if (activeIndex >= 0) return activeIndex;
  const doneIndex = steps.findIndex((step) => step.id === "done" && step.status === "complete");
  return doneIndex >= 0 ? doneIndex : 0;
}

function workflowProgressStatusLabel(status: WorkflowProgressStep["status"]): string {
  switch (status) {
    case "complete":
      return "Done";
    case "current":
      return "Current";
    case "running":
      return "Running";
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
    case "running":
      return "cyan";
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
