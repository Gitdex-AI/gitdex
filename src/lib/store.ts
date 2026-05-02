import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { deleteProjectLocalState } from "@/lib/project-delete";
import type { AgentSessionRecord, JobRecord, JobType, ProjectRecord, Role, WorkflowRecord } from "@/lib/types";

const RUNNING_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export async function listProjects(): Promise<ProjectRecord[]> {
  const rows = getDb().prepare("SELECT payload FROM projects ORDER BY created_at ASC").all() as { payload: string }[];
  return rows.map((row) => normalizeProject(JSON.parse(row.payload) as ProjectRecord));
}

export async function getProject(projectId: string): Promise<ProjectRecord | null> {
  const row = getDb().prepare("SELECT payload FROM projects WHERE project_id = ?").get(projectId) as { payload: string } | undefined;
  return row ? normalizeProject(JSON.parse(row.payload) as ProjectRecord) : null;
}

export async function getProjectBySlug(slug: string): Promise<ProjectRecord | null> {
  const row = getDb().prepare("SELECT payload FROM projects WHERE slug = ?").get(slug) as { payload: string } | undefined;
  return row ? normalizeProject(JSON.parse(row.payload) as ProjectRecord) : null;
}

export async function deleteProject(projectId: string): Promise<ProjectRecord | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  deleteProjectLocalState(getDb(), project);
  return project;
}

export async function createProject(input: {
  name: string;
  githubRepo: string;
  githubAccount: string;
  githubAccessToken: string;
  autoDeploy: boolean;
  agentsFilePath: string;
  updateAgentsFile: boolean;
}): Promise<ProjectRecord> {
  const project: ProjectRecord = {
    projectId: randomUUID().slice(0, 8),
    name: input.name.trim(),
    slug: await uniqueSlug(input.name),
    githubRepo: input.githubRepo.trim(),
    githubAccount: input.githubAccount.trim(),
    githubAccessToken: input.githubAccessToken.trim(),
    autoDeploy: input.autoDeploy,
    agentsFilePath: input.agentsFilePath.trim() || "AGENTS.md",
    updateAgentsFile: input.updateAgentsFile,
    projectManagerSessionId: null,
    architectSessionId: null,
    devopsSessionId: null,
    createdAt: new Date().toISOString(),
    teamRoles: ["developer", "qa", "architect", "devops"]
  };
  await saveProject(project);
  return project;
}

export async function saveProject(project: ProjectRecord): Promise<void> {
  getDb()
    .prepare(
      "INSERT INTO projects (project_id, slug, created_at, payload) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET slug = excluded.slug, created_at = excluded.created_at, payload = excluded.payload"
    )
    .run(project.projectId, project.slug, project.createdAt, JSON.stringify(project));
}

export async function setChatProject(chatId: number, projectId: string): Promise<void> {
  getDb()
    .prepare("INSERT INTO chat_projects (chat_id, project_id) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET project_id = excluded.project_id")
    .run(chatId, projectId);
}

export async function getChatProject(chatId: number): Promise<ProjectRecord | null> {
  const binding = getDb().prepare("SELECT project_id FROM chat_projects WHERE chat_id = ?").get(chatId) as { project_id: string } | undefined;
  return binding ? getProject(binding.project_id) : null;
}

export async function listWorkflows(): Promise<WorkflowRecord[]> {
  const rows = getDb().prepare("SELECT payload FROM workflows ORDER BY created_at ASC").all() as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as WorkflowRecord);
}

export async function getWorkflow(workflowId: string): Promise<WorkflowRecord | null> {
  const row = getDb().prepare("SELECT payload FROM workflows WHERE workflow_id = ?").get(workflowId) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as WorkflowRecord) : null;
}

export async function setWorkflowPaused(workflowId: string, paused: boolean): Promise<WorkflowRecord | null> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow) return null;
  workflow.paused = paused;
  workflow.pausedAt = paused ? new Date().toISOString() : null;
  workflow.timeline.push(paused ? "Workflow paused." : "Workflow resumed.");
  await saveWorkflow(workflow);
  return workflow;
}

export async function saveWorkflow(workflow: WorkflowRecord): Promise<void> {
  getDb()
    .prepare(
      "INSERT INTO workflows (workflow_id, created_at, payload) VALUES (?, ?, ?) ON CONFLICT(workflow_id) DO UPDATE SET created_at = excluded.created_at, payload = excluded.payload"
    )
    .run(workflow.workflowId, workflow.createdAt, JSON.stringify(workflow));
}

export async function listProjectWorkflows(projectId: string): Promise<WorkflowRecord[]> {
  return (await listWorkflows()).filter((workflow) => workflow.projectId === projectId);
}

export async function createJob(input: {
  projectId?: string | null;
  type: JobType;
  payload: JobRecord["payload"];
}): Promise<JobRecord> {
  const now = new Date().toISOString();
  const job: JobRecord = {
    jobId: randomUUID().slice(0, 12),
    projectId: input.projectId ?? null,
    type: input.type,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    error: null,
    payload: input.payload
  };
  await saveJob(job);
  return job;
}

export async function saveJob(job: JobRecord): Promise<void> {
  getDb()
    .prepare(
      "INSERT INTO jobs (job_id, project_id, type, status, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET project_id = excluded.project_id, type = excluded.type, status = excluded.status, updated_at = excluded.updated_at, payload = excluded.payload"
    )
    .run(job.jobId, job.projectId ?? null, job.type, job.status, job.createdAt, job.updatedAt, JSON.stringify(job));
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  const row = getDb().prepare("SELECT payload FROM jobs WHERE job_id = ?").get(jobId) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as JobRecord) : null;
}

export async function touchJobRuntime(jobId: string, input: { pid?: number | null; output?: boolean } = {}): Promise<void> {
  const job = await getJob(jobId);
  if (!job || job.status !== "running") return;
  const now = new Date().toISOString();
  job.runtime = {
    ...(job.runtime ?? {}),
    pid: input.pid ?? job.runtime?.pid ?? null,
    startedAt: job.runtime?.startedAt ?? job.updatedAt ?? now,
    lastHeartbeatAt: now,
    lastOutputAt: input.output ? now : job.runtime?.lastOutputAt ?? null
  };
  job.updatedAt = now;
  await saveJob(job);
}

export async function listJobs(projectId?: string): Promise<JobRecord[]> {
  await recoverStaleRunningJobs(projectId);
  const rows = projectId
    ? getDb().prepare("SELECT payload FROM jobs WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as { payload: string }[]
    : getDb().prepare("SELECT payload FROM jobs ORDER BY created_at DESC").all() as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as JobRecord);
}

export async function cancelPendingJobs(input: {
  projectId?: string | null;
  workflowId: string;
  issueId?: string | null;
  type?: JobType;
  reason: string;
}): Promise<number> {
  const jobs = await listJobs(input.projectId ?? undefined);
  let count = 0;
  for (const job of jobs) {
    if (job.status !== "pending") continue;
    if (input.type && job.type !== input.type) continue;
    if (job.payload.workflowId !== input.workflowId) continue;
    if (input.issueId && job.payload.issueId !== input.issueId) continue;
    job.status = "cancelled";
    job.error = input.reason;
    job.updatedAt = new Date().toISOString();
    job.runtime = { ...(job.runtime ?? {}), finishedAt: job.updatedAt };
    await saveJob(job);
    count += 1;
  }
  return count;
}

export async function claimNextPendingJob(projectId?: string): Promise<JobRecord | null> {
  await recoverStaleRunningJobs(projectId);

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = projectId
      ? db.prepare("SELECT job_id, payload FROM jobs WHERE status = 'pending' AND project_id = ? ORDER BY CASE type WHEN 'issue_run' THEN 0 WHEN 'qa_run' THEN 1 ELSE 2 END, created_at ASC LIMIT 1").get(projectId) as { job_id: string; payload: string } | undefined
      : db.prepare("SELECT job_id, payload FROM jobs WHERE status = 'pending' ORDER BY CASE type WHEN 'issue_run' THEN 0 WHEN 'qa_run' THEN 1 ELSE 2 END, created_at ASC LIMIT 1").get() as { job_id: string; payload: string } | undefined;
    if (!row) {
      db.exec("COMMIT");
      return null;
    }

    const job = JSON.parse(row.payload) as JobRecord;
    job.status = "running";
    job.attempts += 1;
    const now = new Date().toISOString();
    job.updatedAt = now;
    job.runtime = {
      ...(job.runtime ?? {}),
      pid: null,
      startedAt: now,
      lastHeartbeatAt: now,
      lastOutputAt: null,
      finishedAt: null
    };
    const result = db
      .prepare("UPDATE jobs SET status = ?, updated_at = ?, payload = ? WHERE job_id = ? AND status = 'pending'")
      .run(job.status, job.updatedAt, JSON.stringify(job), row.job_id) as { changes: number };
    db.exec("COMMIT");
    return result.changes ? job : null;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function recoverStaleRunningJobs(projectId?: string): Promise<void> {
  const rows = projectId
    ? getDb().prepare("SELECT payload FROM jobs WHERE status = 'running' AND project_id = ?").all(projectId) as { payload: string }[]
    : getDb().prepare("SELECT payload FROM jobs WHERE status = 'running'").all() as { payload: string }[];
  const now = Date.now();

  for (const row of rows) {
    const job = JSON.parse(row.payload) as JobRecord;
    const heartbeatAt = new Date(job.runtime?.lastHeartbeatAt ?? job.updatedAt).getTime();
    if (!Number.isFinite(heartbeatAt) || now - heartbeatAt < RUNNING_JOB_TIMEOUT_MS) continue;

    job.status = "failed";
    job.error = `Job stalled after ${Math.round(RUNNING_JOB_TIMEOUT_MS / 60000)} minutes without Codex output or heartbeat. Retry the workflow job.`;
    job.updatedAt = new Date().toISOString();
    job.runtime = { ...(job.runtime ?? {}), finishedAt: job.updatedAt };
    await saveJob(job);
  }
}

export async function listAgentSessions(projectId: string): Promise<AgentSessionRecord[]> {
  const rows = getDb().prepare("SELECT payload FROM agent_sessions WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as AgentSessionRecord);
}

export async function getAgentSession(sessionKey: string): Promise<AgentSessionRecord | null> {
  const row = getDb().prepare("SELECT payload FROM agent_sessions WHERE session_key = ?").get(sessionKey) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as AgentSessionRecord) : null;
}

export async function saveAgentSession(session: AgentSessionRecord): Promise<void> {
  getDb()
    .prepare(
      "INSERT INTO agent_sessions (session_key, project_id, role, updated_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_key) DO UPDATE SET project_id = excluded.project_id, role = excluded.role, updated_at = excluded.updated_at, payload = excluded.payload"
    )
    .run(session.sessionKey, session.projectId, session.role, session.updatedAt, JSON.stringify(session));
}

export async function appendAgentMessages(input: {
  sessionKey: string;
  projectId: string;
  role: Role;
  title: string;
  sessionId?: string | null;
  workflowId?: string | null;
  issueId?: string | null;
  developerRole?: AgentSessionRecord["developerRole"];
  ownedPaths?: string[];
  currentStep?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  githubIssueNumber?: number | null;
  githubIssueUrl?: string | null;
  prUrl?: string | null;
  labels?: string[];
  lastSyncedAt?: string | null;
  closedAt?: string | null;
  archivedAt?: string | null;
  status?: AgentSessionRecord["status"];
  executionLogs?: NonNullable<AgentSessionRecord["executionLogs"]>;
  messages: AgentSessionRecord["messages"];
}): Promise<AgentSessionRecord> {
  const now = new Date().toISOString();
  const existing = await getAgentSession(input.sessionKey);
  const session: AgentSessionRecord = {
    sessionKey: input.sessionKey,
    projectId: input.projectId,
    role: input.role,
    title: input.title,
    status: input.status ?? existing?.status ?? "active",
    sessionId: input.sessionId ?? existing?.sessionId ?? null,
    workflowId: input.workflowId ?? existing?.workflowId ?? null,
    issueId: input.issueId ?? existing?.issueId ?? null,
    developerRole: input.developerRole ?? existing?.developerRole ?? null,
    ownedPaths: input.ownedPaths ?? existing?.ownedPaths ?? [],
    currentStep: input.currentStep ?? existing?.currentStep ?? null,
    startedAt: input.startedAt ?? existing?.startedAt ?? null,
    finishedAt: input.finishedAt ?? existing?.finishedAt ?? null,
    durationMs: input.durationMs ?? existing?.durationMs ?? null,
    githubIssueNumber: input.githubIssueNumber ?? existing?.githubIssueNumber ?? null,
    githubIssueUrl: input.githubIssueUrl ?? existing?.githubIssueUrl ?? null,
    prUrl: input.prUrl ?? existing?.prUrl ?? null,
    labels: input.labels ?? existing?.labels ?? [],
    lastSyncedAt: input.lastSyncedAt ?? existing?.lastSyncedAt ?? null,
    closedAt: input.closedAt ?? existing?.closedAt ?? null,
    archivedAt: input.archivedAt ?? existing?.archivedAt ?? null,
    messages: [...(existing?.messages ?? []), ...input.messages],
    executionLogs: [...(existing?.executionLogs ?? []), ...(input.executionLogs ?? [])],
    updatedAt: now
  };
  await saveAgentSession(session);
  return session;
}

async function uniqueSlug(name: string): Promise<string> {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  const existing = new Set((await listProjects()).map((project) => project.slug));
  let slug = base;
  let index = 2;
  while (existing.has(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  return slug;
}

function normalizeProject(project: ProjectRecord): ProjectRecord {
  return {
    ...project,
    autoDeploy: project.autoDeploy ?? false,
    agentsFilePath: project.agentsFilePath ?? "AGENTS.md",
    updateAgentsFile: project.updateAgentsFile ?? true,
    architectSessionId: project.architectSessionId ?? null,
    devopsSessionId: project.devopsSessionId ?? null,
    teamRoles: project.teamRoles ?? ["developer", "qa", "architect", "devops"]
  };
}
