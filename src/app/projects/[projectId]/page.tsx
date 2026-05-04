import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert, Badge, Button, Code, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { Archive, ArrowLeft, GitBranch, Info, ListTodo, Plus, RefreshCw, RotateCcw, Settings, Trash2, UserCircle, Wrench } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { ProjectAutoRunIssueAction } from "@/components/ProjectAutoRunIssueAction";
import { ProjectAutoRunIssuesButton } from "@/components/ProjectAutoRunIssuesButton";
import { ProjectAutoSync } from "@/components/ProjectAutoSync";
import { ProjectChatArea } from "@/components/ProjectChatArea";
import { ProjectDetailPanel } from "@/components/ProjectDetailPanel";
import { ProjectArchitectReviewButton } from "@/components/ProjectArchitectReviewButton";
import { ProjectEscalateSessionButton } from "@/components/ProjectEscalateSessionButton";
import { ProjectHandoffForm } from "@/components/ProjectHandoffForm";
import { ProjectHandoffToQaButton } from "@/components/ProjectHandoffToQaButton";
import { ProjectMergePrButton } from "@/components/ProjectMergePrButton";
import { ProjectRetryJobButton } from "@/components/ProjectRetryJobButton";
import { ProjectReturnToDeveloperButton } from "@/components/ProjectReturnToDeveloperButton";
import { ProjectRunDeveloperIssueButton } from "@/components/ProjectRunDeveloperIssueButton";
import { ProjectRunJobButton } from "@/components/ProjectRunJobButton";
import { ProjectRunJobsForm } from "@/components/ProjectRunJobsForm";
import { ProjectSyncForm } from "@/components/ProjectSyncForm";
import { RequirementDetailPanel } from "@/components/RequirementDetailPanel";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ProjectListSidebarLink } from "@/components/projects/ProjectListReturnControls";
import { ProjectsPanel } from "@/components/projects/ProjectsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ToolsPanel } from "@/components/ToolsPanel";
import { WorkflowPauseButton } from "@/components/WorkflowPauseButton";
import { getAutoRunState } from "@/lib/auto-run-control";
import { canAutoRunDeveloper } from "@/lib/auto-run-policy";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { isDiscardableDraftWorkflow } from "@/lib/draft-workflow";
import { checkGhStatus, getCachedGhStatus, saveGhStatus } from "@/lib/gh-status";
import { findReadyForPlannerPayload, formatPmHandoffPayload } from "@/lib/pm-handoff";
import { findDependencyIssue, isDependencySatisfied } from "@/lib/issue-dependencies";
import { getIssueStage, type IssueStage } from "@/lib/issue-stage";
import { getIssueQaStatus } from "@/lib/qa-status";
import { resolveProjectWorkspacePanelNavAction, type ProjectWorkspacePanel } from "@/lib/return-navigation";
import { getAgentSession, getProject, listAgentSessions, listJobs, listProjectWorkflows, listProjects } from "@/lib/store";
import type { AgentSessionRecord, IssueRecord, JobRecord, ProjectRecord, WorkflowRecord } from "@/lib/types";
import type { AutoRunState } from "@/lib/auto-run-control";
import type { WorkflowProgressStep } from "@/lib/workflow-progress";
import {
  hasAnyLabel,
  recoveryReasonForDeveloperStep,
  recoveryReasonForJobs,
  recoveryReasonForMergeStep,
  recoveryReasonForQaStep
} from "@/lib/workflow-recovery";

export default async function ProjectDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ role?: string; session?: string; error?: string; message?: string; autorun?: string; workflow?: string; job?: string; queued?: string; phase?: string; panel?: string }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  await requireConsolePageAuth(buildProjectNextPath(projectId, query));
  const project = await getProject(projectId);
  if (!project) notFound();

  const activeRole = query.role === "architect" ? "architect" : query.role === "devops" ? "devops" : "product_manager";
  const activePanel = normalizeWorkspacePanel(query.panel);
  const activeSessionKey = query.session ?? `${project.projectId}:${activeRole}`;
  const [sessions, workflows, jobs, activeSession, projects, ghUserLogin] = await Promise.all([
    listAgentSessions(project.projectId),
    listProjectWorkflows(project.projectId),
    listJobs(project.projectId),
    getAgentSession(activeSessionKey),
    listProjects(),
    getGhUserLogin()
  ]);
  const switcherProjects = projects.map(({ projectId, name, slug, githubAccount, githubRepo }) => ({
    projectId,
    name,
    slug,
    githubAccount,
    githubRepo
  }));
  const isInspectingIssueSession = Boolean(query.session);
  const allDynamicSessions = sessions.filter((session) => session.role !== "product_manager" && session.role !== "planner" && session.role !== "devops");
  const archivedSessions = allDynamicSessions.filter((session) => session.archivedAt);
  const dynamicSessions = allDynamicSessions.filter((session) => !session.archivedAt);
  const sortedWorkflows = sortWorkflowsLatestFirst(workflows);
  const visibleWorkflows = sortedWorkflows.filter((workflow) => !workflow.archivedAt);
  const activeWorkflows = visibleWorkflows.filter((workflow) => workflow.status !== "done");
  const doneWorkflows = visibleWorkflows.filter((workflow) => workflow.status === "done");
  const queuedWorkflowId = query.workflow ?? null;
  const queuedJobId = query.job ?? null;
  const queuedWorkflow = queuedWorkflowId ? sortedWorkflows.find((workflow) => workflow.workflowId === queuedWorkflowId) ?? null : null;
  const visibleActiveWorkflows = prioritizeById(activeWorkflows, queuedWorkflowId);
  const latestWorkflow = queuedWorkflow ?? visibleActiveWorkflows[0] ?? visibleWorkflows[0] ?? null;
  const pmSession = findWorkflowPmSession(sessions, project.projectId, latestWorkflow);
  const roleSession = activeSession ?? pmSession ?? await getAgentSession(`${project.projectId}:${activeRole}`);
  const readyForPlannerPayload = findReadyForPlannerPayload(pmSession ?? (activeRole === "product_manager" ? roleSession : null));
  const hasMatchingPmHandoffWorkflow = readyForPlannerPayload
    ? visibleWorkflows.some((workflow) => workflow.workflowId !== latestWorkflow?.workflowId && workflow.userRequirement === formatPmHandoffPayload(readyForPlannerPayload))
    : false;
  const hasUnqueuedPmHandoff = Boolean(readyForPlannerPayload && !latestWorkflow && !hasMatchingPmHandoffWorkflow && !queuedWorkflow && !isInspectingIssueSession);
  const workflowPanelWorkflows = hasUnqueuedPmHandoff ? [] : latestWorkflow ? [latestWorkflow] : [];
  const workflowPanelJobs = filterJobsForWorkflows(jobs, workflowPanelWorkflows);
  const workflowPanelSessions = filterSessionsForWorkflows(sessions, workflowPanelWorkflows);
  const chatSessions = isInspectingIssueSession ? sessions : workflowPanelSessions;
  const autoRunState = getAutoRunState(project.projectId);

  return (
    <>
      {query.error && !activePanel && (
        <Alert color="red" icon={<Info size={16} />} mb="md">
          {query.error}
        </Alert>
      )}
      <ProjectAutoSync projectId={project.projectId} />
      <div className="project-chat-layout">
        <ProjectWorkspaceSidebar
          project={project}
          isInspectingIssueSession={isInspectingIssueSession}
          pmSession={pmSession}
          workflows={workflowPanelWorkflows}
          visibleActiveWorkflows={visibleActiveWorkflows}
          requirementWorkflows={visibleWorkflows}
          doneWorkflows={doneWorkflows}
          sessions={sessions}
          jobs={jobs}
          queuedJobId={queuedJobId}
          activeWorkflow={latestWorkflow}
          autoRunState={autoRunState}
          autorunEnabled={query.autorun === "1"}
          activePanel={activePanel}
          switcherProjects={switcherProjects}
          ghUserLogin={ghUserLogin}
        />

        <main className="chat-panel">
          {activePanel ? (
            <WorkspacePanelContent panel={activePanel} project={project} workflows={sortedWorkflows} jobs={jobs} message={query.message} error={query.error} />
          ) : (
            <ProjectChatArea projectId={project.projectId} sessions={chatSessions} jobs={workflowPanelJobs.length ? workflowPanelJobs : jobs} workflows={workflowPanelWorkflows.length ? workflowPanelWorkflows : workflows} activeWorkflowId={latestWorkflow?.workflowId ?? null} inspectedSession={activeSession} readOnly={isInspectingIssueSession} />
          )}
        </main>
      </div>
    </>
  );
}

function buildProjectNextPath(projectId: string, query: { role?: string; session?: string; error?: string; message?: string; autorun?: string; workflow?: string; job?: string; queued?: string; phase?: string; panel?: string }): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return search ? `/projects/${projectId}?${search}` : `/projects/${projectId}`;
}

async function getGhUserLogin(): Promise<string | null> {
  const cached = getCachedGhStatus();
  if (cached?.ok && cached.user.output.trim()) return cached.user.output.trim();
  try {
    const status = await checkGhStatus();
    saveGhStatus(status);
    return status.ok && status.user.output.trim() ? status.user.output.trim() : null;
  } catch {
    return null;
  }
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

function findWorkflowPmSession(sessions: AgentSessionRecord[], projectId: string, workflow: WorkflowRecord | null): AgentSessionRecord | undefined {
  if (!workflow) return sessions.find((session) => session.sessionKey === `${projectId}:product_manager`);
  return sessions.find((session) => session.role === "product_manager" && session.workflowId === workflow.workflowId)
    ?? sessions.find((session) => session.sessionKey === `${projectId}:product_manager`);
}

type WorkflowPhase = "requirements" | "github" | "operations";
type WorkspacePanel = ProjectWorkspacePanel;

function normalizeWorkspacePanel(value: string | undefined): WorkspacePanel | null {
  if (value === "projects" || value === "tools" || value === "settings" || value === "requirements") return value;
  return null;
}

function WorkspacePanelContent({ panel, project, workflows, jobs, message, error }: { panel: WorkspacePanel; project: ProjectRecord; workflows: WorkflowRecord[]; jobs: JobRecord[]; message?: string; error?: string }) {
  const returnTo = `/projects/${project.projectId}?panel=${panel}`;
  const workspaceHref = `/projects/${project.projectId}`;
  return (
    <div className="workspace-panel-content">
      <Group justify="flex-start" mb="md">
        <Button component="a" href={workspaceHref} variant="subtle" leftSection={<ArrowLeft size={16} />}>
          Back to workspace
        </Button>
      </Group>
      {panel === "projects" ? <ProjectsPanel message={message} error={error} /> : null}
      {panel === "tools" ? <ToolsPanel /> : null}
      {panel === "settings" ? <SettingsPanel message={message} error={error} returnTo={returnTo} toolsHref={`/projects/${project.projectId}?panel=tools`} /> : null}
      {panel === "requirements" ? <RequirementsPanelContent project={project} workflows={workflows} jobs={jobs} message={message} error={error} /> : null}
    </div>
  );
}

function normalizeSelectedPhase(value: string | undefined, hasUnqueuedPmHandoff: boolean): WorkflowPhase {
  if (value === "requirements" || value === "github" || value === "operations") return value;
  return hasUnqueuedPmHandoff ? "requirements" : "github";
}

function RequirementsPanelContent({ project, workflows, jobs, message, error }: { project: ProjectRecord; workflows: WorkflowRecord[]; jobs: JobRecord[]; message?: string; error?: string }) {
  const archivedCount = workflows.filter((workflow) => workflow.archivedAt).length;
  return (
    <Stack gap="lg">
      {error ? <Alert color="red" icon={<Info size={16} />}>{error}</Alert> : null}
      {message ? <Alert color="green" icon={<Info size={16} />}>{message}</Alert> : null}
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="sm">
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
            <RequirementPanelRow key={workflow.workflowId} projectId={project.projectId} workflow={workflow} jobs={jobs} />
          )) : (
            <Text size="sm" c="dimmed">No numbered requirements yet.</Text>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

function RequirementPanelRow({ projectId, workflow, jobs }: { projectId: string; workflow: WorkflowRecord; jobs: JobRecord[] }) {
  const planningJob = latestWorkflowJob(workflow.workflowId, jobs, "workflow_run");
  const status = requirementStatus(workflow, planningJob);
  return (
    <div className="requirement-row">
      <div className="requirement-row-body">
        <div className="requirement-row-main">
          <Link href={`/projects/${projectId}?workflow=${encodeURIComponent(workflow.workflowId)}&phase=github`} className="requirement-row-link">
            <Group gap="xs">
              <Code>{workflow.trackingCode ?? workflow.workflowId}</Code>
              <Badge size="xs" variant="light" color={status.color}>{status.label}</Badge>
              {workflow.archivedAt ? <Badge size="xs" variant="outline" color="gray">Archived</Badge> : null}
              <Badge size="xs" variant="outline">{workflow.issues.length} issue{workflow.issues.length === 1 ? "" : "s"}</Badge>
            </Group>
            <Text size="sm" mt={6} lineClamp={2}>{workflow.userRequirement}</Text>
            <Text size="xs" c="dimmed" mt={4}>{workflow.archivedAt ? `Archived ${formatDate(workflow.archivedAt)}` : `Created ${formatDate(workflow.createdAt)}`}</Text>
          </Link>
        </div>
        <Group gap={6} justify="flex-end" wrap="nowrap">
          {!workflow.archivedAt ? renderRequirementRunAction(projectId, planningJob) : null}
          {!workflow.archivedAt && workflow.trackingCode ? <ArchiveRequirementPanelForm projectId={projectId} workflowId={workflow.workflowId} /> : null}
        </Group>
      </div>
    </div>
  );
}

function ArchiveRequirementPanelForm({ projectId, workflowId }: { projectId: string; workflowId: string }) {
  return (
    <form method="post" action={`/api/projects/${projectId}/requirements/${workflowId}/archive`}>
      <input type="hidden" name="returnTo" value={`/projects/${projectId}?panel=requirements`} />
      <Button type="submit" variant="light" color="red" size="compact-xs" radius="xl" leftSection={<Archive size={14} />}>
        Archive
      </Button>
    </form>
  );
}

function ProjectWorkspaceSidebar(input: {
  project: ProjectRecord;
  isInspectingIssueSession: boolean;
  pmSession: AgentSessionRecord | undefined;
  workflows: WorkflowRecord[];
  visibleActiveWorkflows: WorkflowRecord[];
  requirementWorkflows: WorkflowRecord[];
  doneWorkflows: WorkflowRecord[];
  sessions: AgentSessionRecord[];
  jobs: JobRecord[];
  queuedJobId: string | null;
  activeWorkflow: WorkflowRecord | null;
  autoRunState: AutoRunState | null;
  autorunEnabled: boolean;
  activePanel: WorkspacePanel | null;
  switcherProjects: ComponentProps<typeof ProjectSwitcher>["projects"];
  ghUserLogin: string | null;
}) {
  const project = input.project;
  const draftWorkflow = input.requirementWorkflows.find((workflow) => isDiscardableDraftWorkflow(project.projectId, workflow)) ?? null;
  const toolsPanelAction = resolveProjectWorkspacePanelNavAction({ projectId: project.projectId, panel: "tools", activePanel: input.activePanel });
  const settingsPanelAction = resolveProjectWorkspacePanelNavAction({ projectId: project.projectId, panel: "settings", activePanel: input.activePanel });

  return (
    <aside className="project-workspace-sidebar" aria-label="Project workspace">
      <div className="project-sidebar-scroll">
        <div className="project-sidebar-header">
          <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
            <div className="project-sidebar-title">
              <ProjectSwitcher projects={input.switcherProjects} variant="sidebar" />
              <Text size="xs" c="dimmed" lineClamp={1}>{project.githubRepo}</Text>
            </div>
            <ProjectDetailPanel
              project={{
                projectId: project.projectId,
                slug: project.slug,
                githubRepo: project.githubRepo,
                autoDeploy: project.autoDeploy,
                agentsFilePath: project.agentsFilePath,
                updateAgentsFile: project.updateAgentsFile,
                projectManagerSessionId: project.projectManagerSessionId,
                devopsSessionId: project.devopsSessionId
              }}
            />
          </Group>
          <form method="post" action={`/api/projects/${project.projectId}/requirements/draft`}>
            <Button
              type="submit"
              fullWidth
              radius="md"
              leftSection={<Plus size={16} />}
              mt="sm"
            >
              {draftWorkflow ? "Continue Draft" : "New Requirement"}
            </Button>
          </form>
          {draftWorkflow ? (
            <div className="project-sidebar-draft">
              <DraftRequirementEntry projectId={project.projectId} workflowId={draftWorkflow.workflowId} />
            </div>
          ) : null}
        </div>

        <div className="project-sidebar-section">
          <Group justify="space-between" gap="xs" mb="xs" wrap="nowrap">
            <Text size="xs" fw={820} tt="uppercase" c="dimmed">Requirements</Text>
            <Link
              href={`/projects/${project.projectId}?panel=requirements`}
              className={`sidebar-pill-link${input.activePanel === "requirements" ? " active" : ""}`}
            >
              View all
            </Link>
          </Group>
          <RequirementIssueTree
            projectId={project.projectId}
            workflows={input.requirementWorkflows.filter((workflow) => Boolean(workflow.trackingCode))}
            activeWorkflow={input.activeWorkflow?.trackingCode ? input.activeWorkflow : null}
            sessions={input.sessions}
            jobs={input.jobs}
            queuedJobId={input.queuedJobId}
            autoRunState={input.autoRunState}
          />
        </div>
      </div>

      <div className="project-sidebar-footer">
        <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
          <Group gap={8} wrap="nowrap" className="project-sidebar-user">
            <UserCircle size={18} />
            <div>
              <Text size="xs" fw={760}>{input.ghUserLogin ?? "GitHub not connected"}</Text>
              <Text size="xs" c="dimmed" lineClamp={1}>gh account</Text>
            </div>
          </Group>
          <Group gap={4} wrap="nowrap">
            <ProjectSyncForm projectId={project.projectId} compact />
            <ProjectListSidebarLink
              active={input.activePanel === "projects"}
              projectId={project.projectId}
              recentProjectChats={[{ projectId: project.projectId, createdAt: project.createdAt }]}
            />
            <Link
              href={toolsPanelAction.href}
              className={`sidebar-icon-link${toolsPanelAction.active ? " active" : ""}`}
              title="Tools"
              aria-label="Tools"
              data-nav-action={toolsPanelAction.action}
            >
              <Wrench size={16} />
            </Link>
            <Link
              href={`/projects/${project.projectId}/github-triage`}
              className="sidebar-icon-link"
              title="GitHub triage"
              aria-label="GitHub triage"
            >
              <ListTodo size={16} />
            </Link>
            <Link
              href={settingsPanelAction.href}
              className={`sidebar-icon-link${settingsPanelAction.active ? " active" : ""}`}
              title="Settings"
              aria-label="Settings"
              data-nav-action={settingsPanelAction.action}
            >
              <Settings size={16} />
            </Link>
          </Group>
        </Group>
      </div>
    </aside>
  );
}

function RequirementIssueTree(input: {
  projectId: string;
  workflows: WorkflowRecord[];
  activeWorkflow: WorkflowRecord | null;
  sessions: AgentSessionRecord[];
  jobs: JobRecord[];
  queuedJobId: string | null;
  autoRunState: AutoRunState | null;
}): ReactNode {
  if (!input.workflows.length) return <Text size="xs" c="dimmed">No confirmed requirements yet.</Text>;
  return (
    <Stack gap={6}>
      {renderRequirementTreeRows(input.projectId, input.workflows, input.activeWorkflow, input.sessions, input.jobs, input.queuedJobId, input.autoRunState)}
    </Stack>
  );
}

function renderRequirementTreeRows(projectId: string, workflows: WorkflowRecord[], activeWorkflow: WorkflowRecord | null, sessions: AgentSessionRecord[], jobs: JobRecord[], queuedJobId: string | null, autoRunState: AutoRunState | null): ReactNode {
  return workflows.slice(0, 12).map((workflow) => {
    const planningJob = latestWorkflowJob(workflow.workflowId, jobs, "workflow_run");
    const status = requirementStatus(workflow, planningJob);
    const active = workflow.workflowId === activeWorkflow?.workflowId;
    const planningAction = active ? renderRequirementRunAction(projectId, planningJob) : null;
    return (
      <div key={workflow.workflowId} className={`requirement-tree-item${active ? " active" : ""}`}>
        <div className="requirement-tree-link">
          <div className="requirement-tree-topline">
            <div className="requirement-tree-title-actions">
              <Link
                href={`/projects/${projectId}?workflow=${encodeURIComponent(workflow.workflowId)}&phase=github`}
                className="requirement-tree-main-link"
              >
                <Text size="sm" fw={780} lineClamp={1}>{workflow.trackingCode ?? workflow.workflowId}</Text>
                <Badge size="xs" color={status.color} variant="light">{status.label}</Badge>
              </Link>
              <RequirementDetailPanel projectId={projectId} workflow={workflow} status={status} planningJob={planningJob} />
            </div>
            <Group gap={6} justify="flex-end" wrap="nowrap">
              {planningAction}
              {active && !planningAction && workflow.issues.length ? (
                <ProjectAutoRunIssuesButton
                  projectId={projectId}
                  workflowIds={[workflow.workflowId]}
                  issueIds={workflow.issues.map((issue) => issue.issueId)}
                  initialState={autoRunState}
                  runningLabel={activeAutoRunLabel(jobs, [workflow])}
                />
              ) : null}
            </Group>
          </div>
          <Link
            href={`/projects/${projectId}?workflow=${encodeURIComponent(workflow.workflowId)}&phase=github`}
            className="requirement-tree-summary-link"
          >
            <Text className="requirement-tree-summary" size="sm" c="dimmed" lineClamp={3}>{workflow.userRequirement}</Text>
          </Link>
        </div>
        {active ? (
          <div className="requirement-tree-issues">
            <Group justify="space-between" align="center" gap="xs" mb="xs" wrap="nowrap">
              <Text size="xs" fw={820} tt="uppercase" c="dimmed">Issues</Text>
            </Group>
            {renderGithubIssueRows(projectId, [workflow], sessions, jobs, queuedJobId, autoRunState)}
          </div>
        ) : null}
      </div>
    );
  });
}

function DraftRequirementEntry({ projectId, workflowId }: { projectId: string; workflowId: string }) {
  return (
    <div className="draft-requirement-entry">
      <Link href={`/projects/${projectId}?workflow=${encodeURIComponent(workflowId)}&phase=requirements`} className="draft-requirement-link">
        <Text size="sm" fw={760}>Draft requirement</Text>
        <Text size="xs" c="dimmed">Unconfirmed PM chat</Text>
      </Link>
      <DiscardDraftRequirementForm projectId={projectId} workflowId={workflowId} />
    </div>
  );
}

function DiscardDraftRequirementForm({ projectId, workflowId }: { projectId: string; workflowId: string }) {
  return (
    <form method="post" action={`/api/projects/${projectId}/requirements/${workflowId}/discard`} className="draft-discard-form">
      <Button type="submit" variant="subtle" color="red" size="compact-xs" radius="xl" leftSection={<Trash2 size={14} />}>
        Discard
      </Button>
    </form>
  );
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
  if (!workflowIds.size) return sessions.filter((session) => session.role === "product_manager" || session.role === "planner" || session.role === "devops");

  return sessions.filter((session) => {
    if (session.role === "devops") return true;
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
  readyForPlannerPayload: ProjectHandoffPayload;
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
  const qaJobs = input.jobs.filter((job) => job.type === "qa_run");

  return {
    requirement: (
      <Stack gap="xs">
        <Text size="xs" c="dimmed">PM chat is the source of the requirement before it becomes planned work.</Text>
        {input.pmSession ? <SessionLink session={input.pmSession} /> : <Text size="xs" c="dimmed">No PM session has been recorded yet.</Text>}
        {!input.isInspectingIssueSession ? <ProjectHandoffForm projectId={input.projectId} payload={input.readyForPlannerPayload} /> : null}
      </Stack>
    ),
    planning: (
      <Stack gap="xs">
        {renderStepRecovery({
          projectId: input.projectId,
          title: "Recover planner job",
          reason: recoveryReasonForJobs(planningJobs),
          jobs: planningJobs,
          sessions: input.sessions.filter((session) => session.role === "planner"),
          syncLabel: "Sync planning state"
        })}
        {input.queuedWorkflow ? (
          <Alert icon={<GitBranch size={16} />} color="blue" variant="light">
            <Text size="sm" fw={700}>Workflow queued for planner</Text>
            <Text size="xs" c="dimmed">
              {input.queuedWorkflow.trackingCode ?? input.queuedWorkflow.workflowId} is waiting for the planning step.
              {input.queuedJob ? ` Pending job: ${input.queuedJob.type} (${input.queuedJob.status}).` : ""}
            </Text>
          </Alert>
        ) : null}
        {renderStepRunAction(input.projectId, input.jobs, "workflow_run", "Run Planner")}
        {renderJobRows(input.projectId, planningJobs, input.queuedJobId)}
        {renderSessionRows(input.sessions.filter((session) => session.role === "planner"))}
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
        {renderDeveloperIssueRows(input.projectId, input.visibleActiveWorkflows, input.sessions)}
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
        {renderStepRunAction(input.projectId, input.jobs, "qa_run", "Run QA Jobs")}
        {renderJobRows(input.projectId, qaJobs, input.queuedJobId)}
        {renderQaIssueRows(input.projectId, input.activeWorkflows, input.sessions)}
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
            <Link
              key={session.sessionKey}
              href={`/projects/${input.projectId}?session=${encodeURIComponent(session.sessionKey)}`}
              className="action-pill-link danger"
            >
              <RotateCcw size={14} />
              Open blocked session
            </Link>
          ))}
        </Group>
      ) : null}
    </div>
  );
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
            {pendingCount} pending {jobType === "workflow_run" ? "planning" : jobType === "qa_run" ? "QA" : "developer"} job{pendingCount === 1 ? "" : "s"} for this step.
          </Text>
        </div>
        <ProjectRunJobsForm projectId={projectId} label={label} />
      </Group>
    </div>
  );
}

function renderRequirementRows(projectId: string, workflows: WorkflowRecord[], jobs: JobRecord[]): ReactNode {
  if (!workflows.length) return <Text size="xs" c="dimmed">No numbered requirements yet. Once PM confirms a requirement, the confirm action appears here.</Text>;
  return workflows.slice(0, 6).map((workflow) => {
    const planningJob = latestWorkflowJob(workflow.workflowId, jobs, "workflow_run");
    const status = requirementStatus(workflow, planningJob);
    return (
      <div key={workflow.workflowId} className="requirement-row">
        <div className="requirement-row-body">
          <div className="requirement-row-main">
            <Link href={`/projects/${projectId}/workflows/${workflow.workflowId}`} className="requirement-row-link">
              <Text size="sm" fw={780} lineClamp={1}>{workflow.trackingCode ?? workflow.workflowId}</Text>
              <Text size="xs" c="dimmed" mt={3} lineClamp={2}>{workflow.userRequirement}</Text>
            </Link>
          </div>
          <div className="requirement-row-actions">
            <Badge className="requirement-status-badge" size="xs" variant="light" color={status.color}>{status.label}</Badge>
            {renderRequirementRunAction(projectId, planningJob)}
          </div>
        </div>
      </div>
    );
  });
}

function renderRequirementRunAction(projectId: string, planningJob: JobRecord | null): ReactNode {
  if (planningJob?.status === "pending") return <ProjectRunJobButton projectId={projectId} jobId={planningJob.jobId} label="Run Planner" />;
  if (planningJob?.status === "running") return <RunningActionButton label="Planning running" />;
  if (planningJob?.status === "failed") return <ProjectRetryJobButton projectId={projectId} jobId={planningJob.jobId} label="Retry Planner" />;
  return null;
}

function latestWorkflowJob(workflowId: string, jobs: JobRecord[], type: JobRecord["type"]): JobRecord | null {
  return jobs
    .filter((job) => job.type === type && job.payload.workflowId === workflowId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}

function requirementStatus(workflow: WorkflowRecord, planningJob: JobRecord | null): { label: string; color: string } {
  if (!workflow.trackingCode) return { label: "Draft", color: "gray" };
  if (planningJob?.status === "running") return { label: "Planning running", color: "blue" };
  if (planningJob?.status === "pending") return { label: "Ready for planning", color: "blue" };
  if (planningJob?.status === "failed") return { label: "Planning failed", color: "red" };
  switch (workflow.status) {
    case "created":
    case "ready_for_planner":
      return { label: "Awaiting confirmation", color: "blue" };
    case "planned":
      return { label: "Awaiting GitHub intake", color: "gray" };
    case "transferred_to_github":
      return { label: "Tracked in GitHub", color: "gray" };
    case "in_progress":
      return { label: "In progress", color: "gray" };
    case "blocked":
      return { label: "Blocked", color: "red" };
    case "done":
      return { label: "Done", color: "green" };
  }
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
        <Link
          href={`/projects/${projectId}/workflows/${workflow.workflowId}`}
          className="action-pill-link"
        >
          Open
        </Link>
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
          {job.status === "running" ? <ProjectRetryJobButton projectId={projectId} jobId={job.jobId} status="running" /> : null}
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

function renderDeveloperIssueRows(projectId: string, workflows: WorkflowRecord[], sessions: AgentSessionRecord[]): ReactNode {
  const issues = workflows.flatMap((workflow) => workflow.issues);
  if (!issues.length) return <Text size="xs" c="dimmed">No developer issues planned yet.</Text>;
  return issues.map((issue) => {
    const qaSession = sessions.find((session) => session.sessionKey === issue.qaSessionId);
    const qaStatus = getIssueQaStatus(issue, qaSession);
    const canHandoffToQa = Boolean(issue.prUrl) && qaStatus.id === "not_requested";
    return <IssueStatusRow key={issue.issueId} issue={issue} qaStatus={qaStatus} action={canHandoffToQa ? <ProjectHandoffToQaButton projectId={projectId} issueId={issue.issueId} /> : null} />;
  });
}

function renderGithubIssueRows(projectId: string, workflows: WorkflowRecord[], sessions: AgentSessionRecord[], jobs: JobRecord[], queuedJobId: string | null, autoRunState: AutoRunState | null): ReactNode {
  const rows = workflows
    .flatMap((workflow) => workflow.issues.map((issue) => ({ workflow, issue })));
  if (!rows.length) return <Text size="xs" c="dimmed">No GitHub issues are being tracked for this requirement.</Text>;
  return rows.map(({ workflow, issue }) => {
    const developerSession = sessions.find((session) => session.sessionKey === issue.developerSessionId);
    const qaSession = sessions.find((session) => session.sessionKey === issue.qaSessionId);
    const qaStatus = getIssueQaStatus(issue, qaSession);
    const stage = getIssueStage(issue);
    const canHandoffToQa = Boolean(issue.prUrl) && stage === "gd:qa";
    const specBlockedSessionKey = stage === "gd:architect"
      ? (developerSession?.status === "blocked" ? developerSession.sessionKey : qaSession?.status === "blocked" ? qaSession.sessionKey : null)
      : null;
    const canArchitectReview = Boolean(issue.prUrl) && stage === "gd:review" && issue.prState !== "MERGED";
    const canMerge = Boolean(issue.prUrl) && stage === "gd:merge" && issue.prState !== "MERGED";
    const activeJob = latestIssueJob(issue.issueId, jobs);
    const completedDeveloperJob = latestIssueJob(issue.issueId, jobs, "issue_run", "done");
    const canRunDev = canRunDeveloperIssue(issue, workflow.issues);
    const isHighlighted = activeJob?.jobId === queuedJobId;
    const primaryStatusBadge = githubIssueStatusBadge(issue, stage, qaStatus);
    const prNumber = extractPullRequestNumber(issue.prUrl);
    const issueMetaParts = [
      workflow.trackingCode,
      prNumber ? `PR #${prNumber}${issue.prState ? ` ${issue.prState}` : ""}` : issue.prState ? `PR ${issue.prState}` : issue.prUrl ? "PR open" : "no PR",
      issue.executionOrder ? `order ${issue.executionOrder}` : null,
      issue.parallelGroup ? `parallel ${issue.parallelGroup}` : null
    ].filter(Boolean);

    return (
      <div key={issue.issueId} className="github-issue-row" style={isHighlighted ? highlightedCardStyle : undefined}>
        <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
          <div style={{ minWidth: 0 }}>
            <Group gap={6} wrap="wrap">
              <Text size="sm" fw={780} lineClamp={1}>{issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : issue.issueId}</Text>
              {prNumber ? <Badge size="xs" color="gray" variant="light">PR #{prNumber}</Badge> : null}
              <Badge size="xs" variant="outline">{issue.developerRole ?? issue.assigneeRole}</Badge>
              <Badge size="xs" color={primaryStatusBadge.color} variant="light">{primaryStatusBadge.label}</Badge>
            </Group>
            <Text size="xs" c="dimmed" mt={3} lineClamp={2}>{issue.title}</Text>
            <Text size="xs" c="dimmed" mt={4} lineClamp={2}>
              {issueMetaParts.join(" · ")}
            </Text>
            {issue.dependsOn?.length ? (
              <Text size="xs" c="dimmed" mt={2} lineClamp={1}>Depends on: {issue.dependsOn.join(", ")}</Text>
            ) : null}
          </div>
          <Group gap={6} wrap="wrap" justify="flex-end">
            {renderIssueStageAction({
              projectId,
              issue,
              stage,
              activeJob,
              completedDeveloperJob,
              qaStatusId: qaStatus.id,
              canHandoffToQa,
              canArchitectReview,
              canMerge,
              canRunDev,
              specBlockedSessionKey,
              autoRunState
            })}
          </Group>
        </Group>
      </div>
    );
  });
}

function renderIssueStageAction(input: {
  projectId: string;
  issue: IssueRecord;
  stage: IssueStage;
  activeJob: JobRecord | null;
  completedDeveloperJob: JobRecord | null;
  qaStatusId: ReturnType<typeof getIssueQaStatus>["id"];
  canHandoffToQa: boolean;
  canArchitectReview: boolean;
  canMerge: boolean;
  canRunDev: boolean;
  specBlockedSessionKey: string | null;
  autoRunState: AutoRunState | null;
}): ReactNode {
  const autoRunActive = isAutoRunRunningForIssue(input.autoRunState, input.issue);
  if (isCompletedIssue(input.issue)) return null;
  if (input.activeJob?.status === "pending" && autoRunActive) return <RunningActionButton label={runningLabelForJob(input.activeJob, input.issue)} />;
  if (input.activeJob?.status === "pending") return wrapAutoRunAction(runningLabelForJob(input.activeJob, input.issue), <ProjectRunJobButton projectId={input.projectId} jobId={input.activeJob.jobId} label={runLabelForJob(input.activeJob)} />);
  if (input.activeJob?.status === "running") return <RunningActionButton label={runningLabelForJob(input.activeJob, input.issue)} />;
  if (input.activeJob?.status === "failed" && shouldFailedJobReturnToDeveloper(input.activeJob)) return wrapAutoRunAction(runningLabelForStage("Dev", input.issue), <ProjectRunDeveloperIssueButton projectId={input.projectId} issueId={input.issue.issueId} />);
  if (input.activeJob?.status === "failed") return <ProjectRetryJobButton projectId={input.projectId} jobId={input.activeJob.jobId} label={runLabelForJob(input.activeJob)} />;
  if (input.stage === "gd:architect" && input.specBlockedSessionKey) return wrapAutoRunAction(runningLabelForStage("Architect", input.issue), <ProjectEscalateSessionButton projectId={input.projectId} sessionKey={input.specBlockedSessionKey} />);
  if (input.stage === "gd:blocked" && input.issue.prUrl) return wrapAutoRunAction(runningLabelForStage("QA", input.issue), <ProjectHandoffToQaButton projectId={input.projectId} issueId={input.issue.issueId} label="Reset" />);
  if (input.stage === "gd:blocked") return null;
  if (input.stage === "gd:fix" || input.stage === "gd:rebase") return wrapAutoRunAction(runningLabelForStage("Dev", input.issue), <ProjectRunDeveloperIssueButton projectId={input.projectId} issueId={input.issue.issueId} />);
  if (input.canMerge) return wrapAutoRunAction(runningLabelForStage("Merge", input.issue), <ProjectMergePrButton projectId={input.projectId} issueId={input.issue.issueId} prUrl={input.issue.prUrl} />);
  if (input.canArchitectReview) return wrapAutoRunAction(runningLabelForStage("Review", input.issue), <ProjectArchitectReviewButton projectId={input.projectId} issueId={input.issue.issueId} />);
  if (input.canHandoffToQa) return wrapAutoRunAction(runningLabelForStage("QA", input.issue), <ProjectHandoffToQaButton projectId={input.projectId} issueId={input.issue.issueId} />);
  if (input.canRunDev) return wrapAutoRunAction(runningLabelForStage("Dev", input.issue), <ProjectRunDeveloperIssueButton projectId={input.projectId} issueId={input.issue.issueId} />);
  if (isDeveloperBlockedIssue(input.issue)) return wrapAutoRunAction(runningLabelForStage("Dev", input.issue), <ProjectRunDeveloperIssueButton projectId={input.projectId} issueId={input.issue.issueId} />);
  if (hasAnyLabel(input.issue, ["gitdex:blocked", "gitdex:spec-blocked"])) return null;
  if (!input.issue.prUrl && input.completedDeveloperJob && !hasPostDeveloperLifecycleLabel(input.issue)) return wrapAutoRunAction(runningLabelForStage("Dev", input.issue), <ProjectRunDeveloperIssueButton projectId={input.projectId} issueId={input.issue.issueId} />);
  return null;
}

function wrapAutoRunAction(runningLabel: string, action: ReactNode): ReactNode {
  return <ProjectAutoRunIssueAction runningLabel={runningLabel}>{action}</ProjectAutoRunIssueAction>;
}

function shouldFailedJobReturnToDeveloper(job: JobRecord): boolean {
  return job.type === "architect_review_run" || job.type === "merge_run";
}

function isDeveloperBlockedIssue(issue: IssueRecord): boolean {
  return hasAnyLabel(issue, ["gitdex:blocked"]) && !hasAnyLabel(issue, ["gitdex:spec-blocked"]) && issue.prState !== "MERGED";
}

function isCompletedIssue(issue: IssueRecord): boolean {
  return issue.githubState === "CLOSED" || issue.prState === "MERGED" || hasAnyLabel(issue, ["gitdex:merged", "gitdex:deployed"]);
}

function hasPostDeveloperLifecycleLabel(issue: IssueRecord): boolean {
  return hasAnyLabel(issue, [
    "gd:qa",
    "gd:review",
    "gd:merge",
    "gd:fix",
    "gd:rebase",
    "gd:architect",
    "gd:blocked",
    "gd:done",
    "gitdex:need-qa",
    "gitdex:qa-running",
    "qa-passed",
    "gitdex:qa-passed",
    "qa-failed",
    "gitdex:qa-failed",
    "gitdex:spec-blocked",
    "gitdex:env-blocked",
    "gitdex:ready-to-merge",
    "gitdex:needs-rebase",
    "gitdex:merged"
  ]);
}

function canRunDeveloperIssue(issue: IssueRecord, issues: IssueRecord[]): boolean {
  if (!canAutoRunDeveloper(issue)) return false;
  const dependencies = issue.dependsOn ?? [];
  if (!dependencies.length) return true;
  return dependencies.every((dependency) => {
    const upstream = findDependencyIssue(dependency, issues);
    if (!upstream) return false;
    return isDependencySatisfied(upstream);
  });
}

function runLabelForJob(job: JobRecord): string {
  if (job.type === "qa_run") return "Run QA";
  if (job.type === "architect_blocker_run") return "Run Architect";
  if (job.type === "architect_review_run") return "Run Review";
  if (job.type === "merge_run") return "Run Merge";
  return "Run Dev";
}

function runningLabelForJob(job: JobRecord, issue: IssueRecord): string {
  if (job.type === "qa_run") return runningLabelForStage("QA", issue);
  if (job.type === "architect_blocker_run") return runningLabelForStage("Architect", issue);
  if (job.type === "architect_review_run") return runningLabelForStage("Review", issue);
  if (job.type === "merge_run") return runningLabelForStage("Merge", issue);
  return runningLabelForStage("Dev", issue);
}

function runningLabelForStage(stage: string, issue: IssueRecord): string {
  void issue;
  return `${stage} running`;
}

function isAutoRunRunningForIssue(state: AutoRunState | null, issue: IssueRecord): boolean {
  return Boolean(state && ["running", "pause_requested", "cancel_requested"].includes(state.status) && state.issueIds.includes(issue.issueId));
}

function activeAutoRunLabel(jobs: JobRecord[], workflows: WorkflowRecord[]): string | null {
  const activeJob = jobs.find((job) => job.status === "running" && isIssueStageJob(job));
  if (!activeJob?.payload.issueId) return null;
  const issue = workflows.flatMap((workflow) => workflow.issues).find((candidate) => candidate.issueId === activeJob.payload.issueId);
  return issue ? runningLabelForJob(activeJob, issue) : null;
}

function isIssueStageJob(job: JobRecord): boolean {
  return ["architect_blocker_run", "issue_run", "qa_run", "architect_review_run", "merge_run"].includes(job.type);
}

function RunningActionButton({ label }: { label: string }): ReactNode {
  return (
    <Button type="button" variant="light" size="compact-xs" radius="xl" loading disabled title={label}>
      {label}
    </Button>
  );
}

function latestIssueJob(issueId: string, jobs: JobRecord[], type?: JobRecord["type"], status?: JobRecord["status"]): JobRecord | null {
  const activeStatuses = new Set<JobRecord["status"]>(["pending", "running", "failed"]);
  const matchingJobs = jobs
    .filter((job) => (type ? job.type === type : ["issue_run", "qa_run", "architect_blocker_run", "architect_review_run", "merge_run"].includes(job.type)) && job.payload.issueId === issueId);
  if (status) return matchingJobs.filter((job) => job.status === status).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
  const latestSuccessfulAt = Math.max(0, ...matchingJobs.filter((job) => job.status === "done").map((job) => Date.parse(job.updatedAt)));
  return matchingJobs
    .filter((job) => activeStatuses.has(job.status) && (job.status !== "failed" || Date.parse(job.updatedAt) > latestSuccessfulAt))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}

function githubIssueStatusBadge(issue: IssueRecord, stage: IssueStage, qaStatus: ReturnType<typeof getIssueQaStatus>): { label: string; color: string } {
  if (stage === "gd:done") return { label: "Done", color: "green" };
  if (stage === "gd:merge") return { label: "Merge", color: "green" };
  if (stage === "gd:review") return { label: "Review", color: "yellow" };
  if (stage === "gd:qa") return { label: "QA", color: "orange" };
  if (stage === "gd:fix") return { label: "Fix", color: "red" };
  if (stage === "gd:rebase") return { label: "Rebase", color: "orange" };
  if (stage === "gd:architect") return { label: "Architect", color: "red" };
  if (stage === "gd:blocked") return { label: "Blocked", color: "grape" };
  if (stage === "gd:dev") return { label: "Dev", color: "blue" };
  if (qaStatus.id !== "not_requested") return { label: qaStatus.label, color: qaStatus.color };
  return { label: "Tracked", color: "gray" };
}

function extractPullRequestNumber(prUrl?: string | null): number | null {
  const match = prUrl?.match(/\/pull\/(\d+)(?:\D|$)/);
  return match ? Number(match[1]) : null;
}

function renderQaIssueRows(projectId: string, workflows: WorkflowRecord[], sessions: AgentSessionRecord[]): ReactNode {
  const issues = workflows.flatMap((workflow) => workflow.issues).filter((issue) => issue.prUrl || issue.prState || issue.qaSessionId);
  if (!issues.length) return <Text size="xs" c="dimmed">No QA-ready issues yet.</Text>;
  return issues.map((issue) => {
    const qaSession = sessions.find((session) => session.sessionKey === issue.qaSessionId);
    const qaStatus = getIssueQaStatus(issue, qaSession);
    return (
      <IssueStatusRow
        key={issue.issueId}
        issue={issue}
        qaStatus={qaStatus}
      />
    );
  });
}

function renderMergeIssueRows(projectId: string, workflows: WorkflowRecord[]): ReactNode {
  const issues = workflows.flatMap((workflow) => workflow.issues).filter((issue) => ["gd:review", "gd:merge"].includes(getIssueStage(issue)));
  if (!issues.length) return <Text size="xs" c="dimmed">No QA-passed or ready-to-merge issues yet.</Text>;
  return issues.map((issue) => {
    const reviewed = getIssueStage(issue) === "gd:merge";
    return (
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
            <Badge size="xs" color={reviewed ? "green" : "blue"} variant="light">{reviewed ? "reviewed" : "needs review"}</Badge>
            {issue.prUrl && issue.prState !== "MERGED" && !reviewed ? <ProjectArchitectReviewButton projectId={projectId} issueId={issue.issueId} /> : null}
            {issue.prUrl && issue.prState !== "MERGED" && reviewed ? <ProjectMergePrButton projectId={projectId} issueId={issue.issueId} prUrl={issue.prUrl} /> : null}
          </Group>
        </Group>
      </div>
    );
  });
}

function renderCompletedWorkflowRows(projectId: string, workflows: WorkflowRecord[]): ReactNode {
  if (!workflows.length) return <Text size="xs" c="dimmed">No completed workflows yet.</Text>;
  return workflows.slice(0, 6).map((workflow) => (
    <Link key={workflow.workflowId} href={`/projects/${projectId}/workflows/${workflow.workflowId}`} className="completed-workflow-row">
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={700} lineClamp={1}>{workflow.trackingCode ?? workflow.workflowId}</Text>
        <Badge size="xs" variant="light">done</Badge>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={1}>{workflow.userRequirement}</Text>
    </Link>
  ));
}

function renderSessionRows(sessions: AgentSessionRecord[], archived = false): ReactNode {
  if (!sessions.length) return <Text size="xs" c="dimmed">No sessions recorded for this step.</Text>;
  return sessions.map((session) => <SessionLink key={session.sessionKey} session={session} archived={archived || Boolean(session.archivedAt)} />);
}

function IssueStatusRow({ issue, qaStatus, action = null }: { issue: IssueRecord; qaStatus: ReturnType<typeof getIssueQaStatus>; action?: ReactNode }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed" lineClamp={1}>
        {issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : issue.issueId}: {issue.title}
        {issue.prState ? ` · PR ${issue.prState}` : ""}
      </Text>
      <Badge color={qaStatus.color} size="xs" variant="light">{qaStatus.label}</Badge>
      {action}
    </Group>
  );
}

function SessionLink({ session, archived = false }: { session: AgentSessionRecord; archived?: boolean }) {
  return (
    <Link href={`/projects/${session.projectId}?session=${encodeURIComponent(session.sessionKey)}`} className={`session-row${archived ? " archived" : ""}`}>
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
    </Link>
  );
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
