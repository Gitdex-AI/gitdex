import { randomUUID } from "node:crypto";
import { sanitizeAgentSession } from "@/lib/agent-session-sanitize";
import { getDb } from "@/lib/db";
import { publishJobEvent } from "@/lib/job-events";
import { deleteProjectLocalState } from "@/lib/project-delete";
import type { AgentSessionRecord, JobRecord, JobType, ProjectRecord, Role, WorkflowRecord } from "@/lib/types";

const RUNNING_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export type AdminAccountRecord = {
  username: "admin";
  passwordHash: string;
  initializedAt: string;
};

export type AdminSessionRecord = {
  username: "admin";
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

const adminAccountKey = "admin_account";
const adminSessionKey = "admin_session";

export async function getAdminAccount(): Promise<AdminAccountRecord | null> {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(adminAccountKey) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as AdminAccountRecord) : null;
}

export async function saveInitialAdminAccount(account: AdminAccountRecord): Promise<boolean> {
  const result = getDb()
    .prepare("INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)")
    .run(adminAccountKey, JSON.stringify(account)) as { changes: number };
  return result.changes === 1;
}

export async function getAdminSession(): Promise<AdminSessionRecord | null> {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(adminSessionKey) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as AdminSessionRecord) : null;
}

export async function saveAdminSession(session: AdminSessionRecord): Promise<void> {
  getDb()
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(adminSessionKey, JSON.stringify(session));
}

export async function deleteAdminSession(): Promise<void> {
  getDb().prepare("DELETE FROM kv WHERE key = ?").run(adminSessionKey);
}

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
    teamRoles: ["planner", "developer", "qa", "architect", "reviewer", "devops"]
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

export async function archiveWorkflow(workflowId: string): Promise<WorkflowRecord | null> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow) return null;
  workflow.archivedAt = new Date().toISOString();
  workflow.timeline.push(`Requirement archived at ${workflow.archivedAt}.`);
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

export async function deleteWorkflow(workflowId: string): Promise<void> {
  getDb().prepare("DELETE FROM workflows WHERE workflow_id = ?").run(workflowId);
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
  publishJobEvent(job);
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  const row = getDb().prepare("SELECT payload FROM jobs WHERE job_id = ?").get(jobId) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as JobRecord) : null;
}

const jobRuntimeOutputTailLimit = 12000;

export async function touchJobRuntime(jobId: string, input: { pid?: number | null; output?: boolean; outputChunk?: string | null } = {}): Promise<void> {
  const job = await getJob(jobId);
  if (!job || job.status !== "running") return;
  const now = new Date().toISOString();
  const outputChunk = input.outputChunk ?? "";
  const outputTail = outputChunk ? `${job.runtime?.outputTail ?? ""}${outputChunk}`.slice(-jobRuntimeOutputTailLimit) : job.runtime?.outputTail ?? null;
  job.runtime = {
    ...(job.runtime ?? {}),
    pid: input.pid ?? job.runtime?.pid ?? null,
    startedAt: job.runtime?.startedAt ?? job.updatedAt ?? now,
    lastHeartbeatAt: now,
    lastOutputAt: input.output || outputChunk ? now : job.runtime?.lastOutputAt ?? null,
    outputTail,
    outputBytes: (job.runtime?.outputBytes ?? 0) + Buffer.byteLength(outputChunk)
  };
  job.updatedAt = now;
  await saveJob(job);
}

export async function recordJobAgentFinal(jobId: string, final: {
  status: "pass" | "fail" | "blocked";
  summary?: string | null;
}): Promise<void> {
  const job = await getJob(jobId);
  if (!job || job.status !== "running") return;
  const now = new Date().toISOString();
  job.runtime = {
    ...(job.runtime ?? {}),
    lastHeartbeatAt: now,
    agentFinalAt: job.runtime?.agentFinalAt ?? now,
    agentFinalStatus: final.status,
    agentFinalSummary: final.summary?.trim().slice(0, 500) || null
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
      ? db.prepare("SELECT job_id, payload FROM jobs WHERE status = 'pending' AND project_id = ? ORDER BY CASE type WHEN 'memory_init' THEN 0 WHEN 'blocker_analysis_run' THEN 1 WHEN 'architect_blocker_run' THEN 2 WHEN 'issue_run' THEN 3 WHEN 'qa_run' THEN 4 WHEN 'architect_review_run' THEN 5 WHEN 'merge_run' THEN 6 ELSE 7 END, created_at ASC LIMIT 1").get(projectId) as { job_id: string; payload: string } | undefined
      : db.prepare("SELECT job_id, payload FROM jobs WHERE status = 'pending' ORDER BY CASE type WHEN 'memory_init' THEN 0 WHEN 'blocker_analysis_run' THEN 1 WHEN 'architect_blocker_run' THEN 2 WHEN 'issue_run' THEN 3 WHEN 'qa_run' THEN 4 WHEN 'architect_review_run' THEN 5 WHEN 'merge_run' THEN 6 ELSE 7 END, created_at ASC LIMIT 1").get() as { job_id: string; payload: string } | undefined;
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
    if (result.changes) publishJobEvent(job);
    return result.changes ? job : null;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function claimPendingJob(jobId: string, projectId?: string): Promise<JobRecord | null> {
  await recoverStaleRunningJobs(projectId);

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = projectId
      ? db.prepare("SELECT job_id, payload FROM jobs WHERE job_id = ? AND status = 'pending' AND project_id = ?").get(jobId, projectId) as { job_id: string; payload: string } | undefined
      : db.prepare("SELECT job_id, payload FROM jobs WHERE job_id = ? AND status = 'pending'").get(jobId) as { job_id: string; payload: string } | undefined;
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
    if (result.changes) publishJobEvent(job);
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
  const sanitizedSession = sanitizeAgentSession(session);
  getDb()
    .prepare(
      "INSERT INTO agent_sessions (session_key, project_id, role, updated_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_key) DO UPDATE SET project_id = excluded.project_id, role = excluded.role, updated_at = excluded.updated_at, payload = excluded.payload"
    )
    .run(sanitizedSession.sessionKey, sanitizedSession.projectId, sanitizedSession.role, sanitizedSession.updatedAt, JSON.stringify(sanitizedSession));
}

export async function deleteAgentSession(sessionKey: string): Promise<void> {
  getDb().prepare("DELETE FROM agent_sessions WHERE session_key = ?").run(sessionKey);
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
  const contextChanged = Boolean(existing) && (
    Boolean(input.workflowId && input.workflowId !== existing?.workflowId) ||
    Boolean(input.issueId && input.issueId !== existing?.issueId) ||
    Boolean(input.prUrl && input.prUrl !== existing?.prUrl)
  );
  const resetLifecycle = contextChanged || input.status === "active";
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
    startedAt: input.startedAt ?? (resetLifecycle ? null : existing?.startedAt ?? null),
    finishedAt: input.finishedAt ?? (resetLifecycle ? null : existing?.finishedAt ?? null),
    durationMs: input.durationMs ?? (resetLifecycle ? null : existing?.durationMs ?? null),
    githubIssueNumber: input.githubIssueNumber ?? existing?.githubIssueNumber ?? null,
    githubIssueUrl: input.githubIssueUrl ?? existing?.githubIssueUrl ?? null,
    prUrl: input.prUrl ?? existing?.prUrl ?? null,
    labels: input.labels ?? existing?.labels ?? [],
    lastSyncedAt: input.lastSyncedAt ?? existing?.lastSyncedAt ?? null,
    closedAt: input.closedAt ?? (resetLifecycle ? null : existing?.closedAt ?? null),
    archivedAt: input.archivedAt ?? (resetLifecycle ? null : existing?.archivedAt ?? null),
    messages: mergeAgentMessages(existing?.messages ?? [], input.messages),
    executionLogs: [...(existing?.executionLogs ?? []), ...(input.executionLogs ?? [])],
    updatedAt: now
  };
  await saveAgentSession(session);
  return session;
}

function mergeAgentMessages(existing: AgentSessionRecord["messages"], incoming: AgentSessionRecord["messages"]): AgentSessionRecord["messages"] {
  const messages = [...existing];
  for (const message of incoming) {
    const index = message.messageId ? messages.findIndex((item) => item.messageId === message.messageId) : -1;
    if (index === -1) {
      messages.push(message);
    } else {
      messages[index] = {
        ...messages[index],
        ...message,
        executionLogs: message.executionLogs ?? messages[index].executionLogs
      };
    }
  }
  return messages;
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
    teamRoles: project.teamRoles ?? ["planner", "developer", "qa", "architect", "reviewer", "devops"]
  };
}
