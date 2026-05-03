"use client";

import { Alert, Badge, Button, Code, Group, Stack, Text, Textarea } from "@mantine/core";
import { AlertTriangle, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { chatRoleLabel, parseChatTarget } from "@/lib/chat-routing";
import type { AgentMessage, AgentSessionRecord, IssueRecord, JobRecord, WorkflowRecord } from "@/lib/types";

type TimelineMessage = AgentMessage & {
  kind: "message";
  sessionKey: string;
  sourceLabel: string;
  sourceRole: AgentSessionRecord["role"];
  session: AgentSessionRecord | null;
  executionLogs?: TimelineExecutionLog[];
};

type TimelineExecutionLog = NonNullable<AgentSessionRecord["executionLogs"]>[number] & {
  kind: "execution-log";
  sessionKey: string;
  sourceLabel: string;
  sourceRole: AgentSessionRecord["role"];
  session: AgentSessionRecord;
};

export function ProjectChatArea({
  projectId,
  sessions,
  jobs,
  workflows,
  inspectedSession,
  readOnly
}: {
  projectId: string;
  sessions: AgentSessionRecord[];
  jobs: JobRecord[];
  workflows: WorkflowRecord[];
  inspectedSession: AgentSessionRecord | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState<TimelineMessage | null>(null);
  const [liveJobs, setLiveJobs] = useState(jobs);
  const liveJobsRef = useRef(jobs);
  const visibleSessions = readOnly && inspectedSession ? [inspectedSession] : sessions;

  useEffect(() => {
    setLiveJobs(jobs);
  }, [jobs]);

  useEffect(() => {
    liveJobsRef.current = liveJobs;
  }, [liveJobs]);

  useEffect(() => {
    setPending(false);
    setOptimisticMessage(null);
  }, [sessions, inspectedSession?.updatedAt, readOnly]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTop = scroll.scrollHeight;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [visibleSessions, optimisticMessage?.createdAt, pending, liveJobs]);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/jobs/events`);
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, 350);
    };
    const upsertJob = (job: JobRecord) => {
      setLiveJobs((current) => {
        const index = current.findIndex((item) => item.jobId === job.jobId);
        if (index === -1) return [job, ...current];
        const next = [...current];
        next[index] = job;
        return next;
      });
      scheduleRefresh();
    };
    source.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { jobs: JobRecord[] };
        setLiveJobs(payload.jobs);
      } catch {
        scheduleRefresh();
      }
    });
    source.addEventListener("job", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { job: JobRecord };
        upsertJob(payload.job);
      } catch {
        scheduleRefresh();
      }
    });
    source.onerror = () => {
      if (liveJobsRef.current.some((job) => job.status === "running")) scheduleRefresh();
    };
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      source.close();
    };
  }, [projectId, router]);

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const message = String(formData.get("message") ?? "").trim();
    if (!message) return;
    const target = parseChatTarget(message);
    const targetLabel = chatRoleLabel(target.role);

    setPending(true);
    setOptimisticMessage({
      role: "user",
      kind: "message",
      content: target.message,
      createdAt: new Date().toISOString(),
      sessionKey: `pending:${target.role}`,
      sourceLabel: `You → ${targetLabel}`,
      sourceRole: target.role,
      session: null
    });
    form.reset();

    const response = await fetch(form.action, {
      method: "POST",
      body: formData,
      redirect: "follow"
    });
    const destination = response.url ? new URL(response.url).pathname + new URL(response.url).search : `/projects/${projectId}`;
    router.push(destination);
    router.refresh();
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || pending) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <>
      {readOnly ? (
        <div className="chat-session-status">
          <Badge variant="outline">Read-only session</Badge>
          <Text size="xs" c="dimmed">
            Inspecting archived agent context
          </Text>
        </div>
      ) : null}
      <div ref={scrollRef} className="chat-scroll">
        <MessageList projectId={projectId} sessions={visibleSessions} jobs={liveJobs} workflows={workflows} inspectedSession={readOnly ? inspectedSession : null} optimisticMessage={optimisticMessage} pending={pending} />
        <div ref={bottomRef} aria-hidden="true" />
      </div>
      {!readOnly && (
        <div className="chat-composer">
          <form ref={formRef} method="post" action={`/api/projects/${projectId}/chat`} className="chat-composer-form" onSubmit={submitMessage}>
            <Textarea
              name="message"
              aria-label="Message project agents"
              placeholder="@PM clarify scope, @devops check deployment..."
              autosize
              minRows={1}
              maxRows={7}
              required
              disabled={pending}
              onKeyDown={submitOnEnter}
              classNames={{ input: "chat-composer-input" }}
            />
            <div className="chat-composer-actions">
              <div className="chat-composer-status" aria-live="polite">
                {pending ? (
                  <>
                    <LoaderCircle size={14} className="chat-composer-spinner" />
                    <Text size="xs" c="dimmed">Message sent. Codex agent is working...</Text>
                  </>
                ) : (
                  <Text size="xs" c="dimmed">
                    Default target <Code>PM</Code>
                  </Text>
                )}
              </div>
              <Button type="submit" radius="xl" leftSection={<Send size={16} />} loading={pending} disabled={pending}>
                {pending ? "Working" : "Send"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function RunningAgentMessages({ jobs, sessions, workflows }: { jobs: JobRecord[]; sessions: AgentSessionRecord[]; workflows: WorkflowRecord[] }) {
  const runningJobs = jobs.filter((job) => job.status === "running");
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!runningJobs.length) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [runningJobs.length]);

  if (!runningJobs.length) return null;

  return (
    <>
      {runningJobs.map((job) => {
        const session = findJobSession(job, sessions);
        const label = runningAgentLabel(job, session);
        const issueLabel = runningJobIssueLabel(job, session, workflows);
        const startedAt = job.runtime?.startedAt ?? job.updatedAt ?? job.createdAt;
        const elapsed = formatElapsed(startedAt);
        const outputTail = job.runtime?.outputTail?.trimEnd();
        return (
          <div key={job.jobId} className="chat-message assistant pending" aria-live="polite">
            <div className="chat-avatar">{runningAgentAvatar(job, session)}</div>
            <div className="chat-bubble running-agent-bubble">
              <Group gap="xs" mb={6} justify="space-between" align="center">
                <Group gap={6}>
                  <Badge variant="light">{label}</Badge>
                  {issueLabel ? <Badge size="xs" variant="outline">{issueLabel}</Badge> : null}
                </Group>
                <Text component="time" dateTime={new Date().toISOString()} size="xs" c="dimmed" title={`Running for ${elapsed}`}>
                  {elapsed}
                </Text>
              </Group>
              <Text size="sm" c="dimmed" className="running-agent-line">
                <LoaderCircle size={13} className="chat-composer-spinner" />
                <span>{label} working{issueLabel ? ` on ${issueLabel}` : ""}...({elapsed})</span>
              </Text>
              {outputTail ? (
                <RunningAgentLog label={label} output={outputTail} />
              ) : (
                <Text size="xs" c="dimmed" className="running-agent-waiting">
                  Waiting for Codex output...
                </Text>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function RunningAgentLog({ label, output }: { label: string; output: string }) {
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const element = logRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [output]);

  return (
    <pre ref={logRef} className="running-agent-log" aria-label={`${label} live output`}>
      {output}
    </pre>
  );
}

function MessageLiveOutput({ message, jobs }: { message: TimelineMessage; jobs: JobRecord[] }) {
  const job = message.jobId ? jobs.find((item) => item.jobId === message.jobId) : null;
  const outputTail = job?.runtime?.outputTail?.trimEnd();
  if (outputTail) return <RunningAgentLog label={message.sourceLabel} output={outputTail} />;
  return (
    <Text size="xs" c="dimmed" className="running-agent-waiting">
      Waiting for Codex output...
    </Text>
  );
}

function messageJobElapsed(message: TimelineMessage, jobs: JobRecord[]): string {
  const job = message.jobId ? jobs.find((item) => item.jobId === message.jobId) : null;
  const startedAt = job?.runtime?.startedAt ?? message.updatedAt ?? message.createdAt;
  return formatElapsed(startedAt);
}

function isLiveMessage(message: TimelineMessage): boolean {
  return message.status === "running" || message.status === "pending";
}

function isMessageActivelyRunning(message: TimelineMessage, jobs: JobRecord[]): boolean {
  if (!isLiveMessage(message)) return false;
  const job = message.jobId ? jobs.find((item) => item.jobId === message.jobId) : null;
  return !job?.runtime?.agentFinalAt;
}

function messageDisplayContent(message: TimelineMessage, jobs: JobRecord[]): string {
  if (!isLiveMessage(message)) return message.content;
  const job = message.jobId ? jobs.find((item) => item.jobId === message.jobId) : null;
  if (job?.runtime?.agentFinalAt) {
    const status = job.runtime.agentFinalStatus ? ` (${job.runtime.agentFinalStatus})` : "";
    const summary = job.runtime.agentFinalSummary ? `: ${job.runtime.agentFinalSummary}` : "";
    return `Agent final received${status}${summary}`;
  }
  return `${message.content}(${messageJobElapsed(message, jobs)})`;
}

function canResolveMessageJob(message: TimelineMessage, jobs: JobRecord[]): message is TimelineMessage & { jobId: string } {
  if (message.role !== "assistant" || !message.jobId || (message.status !== "running" && message.status !== "pending")) return false;
  const job = jobs.find((item) => item.jobId === message.jobId);
  return job?.status === "running" && isTerminalSession(message.session);
}

function isTerminalSession(session: AgentSessionRecord | null): boolean {
  return session?.status === "done" || session?.status === "blocked";
}

function ResolveJobStatusButton({ projectId, jobId, onResolved }: { projectId: string; jobId: string; onResolved: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function resolveStatus() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs/${jobId}/resolve`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      onResolved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Status resolve failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Group gap={4}>
      <Button type="button" size="compact-xs" radius="xl" variant="light" color="green" loading={pending} onClick={resolveStatus}>
        Resolve Status
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </Group>
  );
}

function findJobSession(job: JobRecord, sessions: AgentSessionRecord[]): AgentSessionRecord | null {
  if (!job.payload.issueId) {
    if (job.type === "workflow_run") return sessions.find((session) => session.role === "planner" && session.workflowId === job.payload.workflowId) ?? null;
    return null;
  }
  if (job.type === "architect_blocker_run") {
    return sessions.find((session) => session.sessionKey === job.payload.sessionKey)
      ?? sessions.find((session) => session.issueId === job.payload.issueId)
      ?? null;
  }
  const expectedRole = job.type === "qa_run" ? "qa" : "developer";
  if (job.type === "architect_review_run" || job.type === "merge_run") {
    return sessions.find((session) => session.role === "reviewer" && session.issueId === job.payload.issueId) ?? null;
  }
  return sessions.find((session) => session.role === expectedRole && session.issueId === job.payload.issueId) ?? null;
}

function runningAgentLabel(job: JobRecord, session: AgentSessionRecord | null): string {
  if (job.type === "workflow_run") return "Planner";
  if (job.type === "architect_blocker_run") return "Architect";
  if (job.type === "architect_review_run" || job.type === "merge_run") return "Reviewer";
  if (job.type === "qa_run") return "QA";
  if (job.type === "issue_run") return session?.developerRole ?? "Dev";
  if (session?.developerRole) return session.developerRole;
  if (session?.role === "developer") return "Dev";
  if (session?.role === "qa") return "QA";
  if (session?.role === "architect") return "Architect";
  if (session?.role === "planner") return "Planner";
  if (session?.role === "reviewer") return "Reviewer";
  return "Agent";
}

function runningAgentAvatar(job: JobRecord, session: AgentSessionRecord | null): string {
  if (job.type === "qa_run") return "QA";
  if (job.type === "issue_run") return "DV";
  if (job.type === "workflow_run") return "PL";
  if (job.type === "architect_blocker_run") return "AR";
  if (job.type === "architect_review_run" || job.type === "merge_run") return "RV";
  if (session?.role === "qa") return "QA";
  if (session?.role === "developer") return "DV";
  if (session?.role === "architect") return "AR";
  if (session?.role === "planner") return "PL";
  if (session?.role === "reviewer") return "RV";
  if (session?.role === "devops") return "DO";
  if (session?.role === "product_manager") return "PM";
  return "A";
}

function runningJobIssueLabel(job: JobRecord, session: AgentSessionRecord | null, workflows: WorkflowRecord[]): string | null {
  const issue = findWorkflowIssue(job.payload.issueId ?? null, workflows);
  const issueNumber = issue?.githubIssueNumber ?? session?.githubIssueNumber ?? null;
  if (issueNumber) return `issue #${issueNumber}`;
  if (job.payload.issueId) return `issue ${job.payload.issueId}`;
  if (job.type === "workflow_run") return `requirement ${job.payload.workflowId}`;
  return null;
}

function findWorkflowIssue(issueId: string | null, workflows: WorkflowRecord[]): IssueRecord | null {
  if (!issueId) return null;
  return workflows.flatMap((workflow) => workflow.issues).find((issue) => issue.issueId === issueId) ?? null;
}

function MessageList({
  projectId,
  sessions,
  jobs,
  workflows,
  inspectedSession,
  optimisticMessage,
  pending
}: {
  projectId: string;
  sessions: AgentSessionRecord[];
  jobs: JobRecord[];
  workflows: WorkflowRecord[];
  inspectedSession: AgentSessionRecord | null;
  optimisticMessage: TimelineMessage | null;
  pending: boolean;
}) {
  const router = useRouter();
  const messages = [
    ...sessions.flatMap((session) => timelineMessagesForSession(session)),
    ...(optimisticMessage ? [optimisticMessage] : [])
  ]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => compareTimelineItems(left.message, right.message) || left.index - right.index)
    .map((item) => item.message);

  const hasLiveMessages = messages.some((message) => message.kind === "message" && (message.status === "running" || message.status === "pending"));
  const hasLiveJobs = jobs.some((job) => job.status === "running" || job.status === "pending");
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!hasLiveMessages && !hasLiveJobs) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [hasLiveMessages, hasLiveJobs]);

  const runningStatus = null;

  if (!messages.length && !jobs.some((job) => job.status === "running")) {
    return <Text c="dimmed" ta="center" mt="xl">No messages yet.</Text>;
  }

  return (
    <Stack gap="md">
      {inspectedSession ? <SessionRuntime projectId={projectId} session={inspectedSession} /> : null}
      {messages.map((message, index) => (
        message.kind === "execution-log"
          ? <ExecutionLogItem key={`${message.sessionKey}-log-${message.createdAt}-${index}`} log={message} />
          : (
            <div key={`${message.sessionKey}-${message.createdAt}-${index}`} className={`chat-message ${message.role}`}>
              <div className="chat-avatar">{chatAvatarText(message)}</div>
              <div className="chat-bubble">
                <Group gap="xs" mb={6} justify="space-between" align="center">
                  <Group gap={6}>
                    <Badge variant="light">{message.sourceLabel}</Badge>
                    {message.session?.workflowId ? <Badge size="xs" variant="outline">{message.session.workflowId}</Badge> : null}
                    {message.session?.issueId ? <Badge size="xs" variant="outline">{message.session.issueId}</Badge> : null}
                    {messageExecutionDuration(message) ? <Badge size="xs" color="gray" variant="light">{messageExecutionDuration(message)}</Badge> : null}
                  </Group>
                  <Group gap={6}>
                    {canResolveMessageJob(message, jobs) ? <ResolveJobStatusButton projectId={projectId} jobId={message.jobId} onResolved={() => router.refresh()} /> : null}
                    <Text component="time" dateTime={message.createdAt} size="xs" c="dimmed">
                      {formatMessageTime(message.createdAt)}
                    </Text>
                  </Group>
                </Group>
                <Text size="sm" c={isLiveMessage(message) ? "dimmed" : undefined} className={isLiveMessage(message) ? "running-agent-line" : undefined} style={{ whiteSpace: "pre-wrap" }}>
                  {isMessageActivelyRunning(message, jobs) ? <LoaderCircle size={13} className="chat-composer-spinner" /> : null}
                  <span>{messageDisplayContent(message, jobs)}</span>
                </Text>
                {isMessageActivelyRunning(message, jobs) ? <MessageLiveOutput message={message} jobs={jobs} /> : null}
                {message.executionLogs?.length ? <InlineExecutionLogs logs={message.executionLogs} /> : null}
              </div>
            </div>
          )
      ))}
      {pending && (
        <div className="chat-message assistant pending">
          <div className="chat-avatar">A</div>
          <div className="chat-bubble">
            <Group gap="xs" mb={6} justify="space-between" align="center">
              <Badge variant="light">assistant</Badge>
              <Text component="time" dateTime={new Date().toISOString()} size="xs" c="dimmed">
                now
              </Text>
            </Group>
            <Text size="sm" c="dimmed">Codex agent is working...</Text>
          </div>
        </div>
      )}
      {runningStatus}
    </Stack>
  );
}

function compareTimelineItems(left: TimelineMessage | TimelineExecutionLog, right: TimelineMessage | TimelineExecutionLog): number {
  const timeDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (timeDiff) return timeDiff;
  const sessionDiff = left.sessionKey.localeCompare(right.sessionKey);
  if (sessionDiff) return sessionDiff;
  return timelinePriority(left) - timelinePriority(right);
}

function timelinePriority(item: TimelineMessage | TimelineExecutionLog): number {
  if (item.kind === "message" && item.role === "user") return 0;
  if (item.kind === "message") return 1;
  return 2;
}

function timelineMessagesForSession(session: AgentSessionRecord): Array<TimelineMessage | TimelineExecutionLog> {
  const logs = (session.executionLogs ?? []).map((log) => ({
    ...log,
    kind: "execution-log",
    sessionKey: session.sessionKey,
    sourceLabel: chatRoleLabel(session.role, session.title, session.developerRole),
    sourceRole: session.role,
    session
  } satisfies TimelineExecutionLog));
  const logsByMessageIndex = pairExecutionLogsWithAssistantMessages(session.messages, logs);
  const messages = session.messages.map((message, index) => ({
    ...message,
    kind: "message",
    sessionKey: session.sessionKey,
    sourceLabel: message.role === "user" ? `You → ${chatRoleLabel(session.role, session.title, session.developerRole)}` : chatRoleLabel(session.role, session.title, session.developerRole),
    sourceRole: session.role,
    session,
    executionLogs: message.executionLogs?.length
      ? message.executionLogs.map((log) => timelineExecutionLog(log, session))
      : logsByMessageIndex.get(index)
  } satisfies TimelineMessage));
  const attachedLogs = new Set([
    ...messages.flatMap((message) => message.executionLogs ?? []),
    ...[...logsByMessageIndex.values()].flat()
  ]);
  const unattachedLogs = logs.filter((log) => !attachedLogs.has(log));
  return [...messages, ...unattachedLogs];
}

function timelineExecutionLog(log: NonNullable<AgentMessage["executionLogs"]>[number], session: AgentSessionRecord): TimelineExecutionLog {
  return {
    ...log,
    kind: "execution-log",
    sessionKey: session.sessionKey,
    sourceLabel: chatRoleLabel(session.role, session.title, session.developerRole),
    sourceRole: session.role,
    session
  };
}

function pairExecutionLogsWithAssistantMessages(messages: AgentMessage[], logs: TimelineExecutionLog[]): Map<number, TimelineExecutionLog[]> {
  const assistantIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter((item) => item.message.role === "assistant");
  const logsByMessageIndex = new Map<number, TimelineExecutionLog[]>();
  const usedAssistantIndexes = new Set<number>();

  for (const log of logs) {
    const logTime = new Date(log.createdAt).getTime();
    const match = assistantIndexes.find((item) => {
      if (usedAssistantIndexes.has(item.index)) return false;
      return new Date(item.message.createdAt).getTime() >= logTime;
    });
    if (!match) continue;
    usedAssistantIndexes.add(match.index);
    logsByMessageIndex.set(match.index, [...(logsByMessageIndex.get(match.index) ?? []), log]);
  }
  return logsByMessageIndex;
}

function ExecutionLogItem({ log }: { log: TimelineExecutionLog }) {
  return (
    <div className="chat-message system">
      <div className="chat-avatar">{chatAvatarText(log)}</div>
      <div className="chat-bubble execution-log-bubble">
        <details>
          <summary>
            <Group gap="xs" justify="space-between" wrap="nowrap">
              <Group gap={6}>
                <Badge variant="light">{log.sourceLabel}</Badge>
                <Badge size="xs" color={log.status === "failed" ? "red" : "green"} variant="light">execution log</Badge>
                {executionLogDuration(log) ? <Badge size="xs" color="gray" variant="light">{executionLogDuration(log)}</Badge> : null}
              </Group>
              <Text component="time" dateTime={log.createdAt} size="xs" c="dimmed">
                {formatMessageTime(log.createdAt)}
              </Text>
            </Group>
            <Text size="sm" fw={760} mt={6}>{log.title}</Text>
          </summary>
          <pre className="execution-log-content">{log.content || "No Codex execution output captured."}</pre>
        </details>
      </div>
    </div>
  );
}

function InlineExecutionLogs({ logs }: { logs: TimelineExecutionLog[] }) {
  return (
    <div className="inline-execution-logs">
      {logs.map((log, index) => (
        <details key={`${log.createdAt}-${index}`}>
          <summary>
            <Group gap="xs" justify="space-between" wrap="nowrap">
              <Group gap={6}>
                <Badge size="xs" color={log.status === "failed" ? "red" : "green"} variant="light">execution log</Badge>
                <Text size="xs" c="dimmed" lineClamp={1}>{log.title}</Text>
              </Group>
              <Text component="time" dateTime={log.createdAt} size="xs" c="dimmed">
                {formatMessageTime(log.createdAt)}
              </Text>
            </Group>
          </summary>
          <pre className="execution-log-content">{log.content || "No Codex execution output captured."}</pre>
        </details>
      ))}
    </div>
  );
}

function executionLogDuration(log: TimelineExecutionLog): string | null {
  const durationMs = log.durationMs ?? log.session.durationMs ?? null;
  return durationMs == null ? null : formatDuration(durationMs);
}

function messageExecutionDuration(message: TimelineMessage): string | null {
  const durationMs = message.executionLogs?.[message.executionLogs.length - 1]?.durationMs ?? message.session?.durationMs ?? null;
  return durationMs == null ? null : formatDuration(durationMs);
}

function chatAvatarText(message: TimelineMessage | TimelineExecutionLog): string {
  if (message.kind === "message" && message.role === "user") return "U";
  if (message.sourceRole === "product_manager") return "PM";
  if (message.sourceRole === "architect") return "AR";
  if (message.sourceRole === "planner") return "PL";
  if (message.sourceRole === "reviewer") return "RV";
  if (message.sourceRole === "devops") return "DO";
  if (message.sourceRole === "developer") return "DV";
  if (message.sourceRole === "qa") return "QA";
  return message.kind === "message" && message.role === "assistant" ? "A" : "S";
}

function SessionRuntime({ projectId, session }: { projectId: string; session: AgentSessionRecord }) {
  const hasRuntime = session.currentStep || session.startedAt || session.githubIssueNumber || session.prUrl || session.labels?.length;
  if (!hasRuntime) return null;
  const blockedMessage = session.status === "blocked" ? lastAssistantMessage(session) : null;

  return (
    <div className="session-runtime">
      {blockedMessage ? (
        <Alert color="red" icon={<AlertTriangle size={16} />} mb="sm" className="blocked-session-alert">
          <Group justify="space-between" align="flex-start" gap="md">
            <div>
              <Text fw={780} size="sm">{isToolBlocker(blockedMessage) ? "Codex tool blocker" : "Blocked reason"}</Text>
              <Text size="sm" mt={4} style={{ whiteSpace: "pre-wrap" }}>{blockedMessage}</Text>
            </div>
            <BlockedSessionActions projectId={projectId} sessionKey={session.sessionKey} blockedMessage={blockedMessage} />
          </Group>
        </Alert>
      ) : null}
      <Group justify="space-between" gap="xs">
        <div>
          <Text size="sm" fw={780}>{session.currentStep ?? session.title}</Text>
          <Text size="xs" c="dimmed">
            {session.startedAt ? `Started ${formatDateTime(session.startedAt)}` : "Not started"}
            {session.durationMs != null ? ` · ${formatDuration(session.durationMs)}` : ""}
            {session.finishedAt ? ` · Finished ${formatDateTime(session.finishedAt)}` : ""}
          </Text>
        </div>
        <Badge variant="light">{session.status}</Badge>
      </Group>
      <Group gap="xs" mt="xs">
        {session.githubIssueNumber ? <Badge variant="outline">Issue #{session.githubIssueNumber}</Badge> : null}
        {session.prUrl ? <Badge variant="outline">PR</Badge> : null}
        {session.lastSyncedAt ? <Badge variant="outline">Synced {formatDateTime(session.lastSyncedAt)}</Badge> : null}
      </Group>
      {(session.githubIssueUrl || session.prUrl) && (
        <Group gap="xs" mt="xs">
          {session.githubIssueUrl ? <a className="runtime-link" href={session.githubIssueUrl}>GitHub Issue</a> : null}
          {session.prUrl ? <a className="runtime-link" href={session.prUrl}>Pull Request</a> : null}
        </Group>
      )}
      {session.labels?.length ? (
        <Group gap={6} mt="xs">
          {session.labels.slice(0, 8).map((label) => <Badge key={label} size="xs" variant="light">{label}</Badge>)}
        </Group>
      ) : null}
    </div>
  );
}

function BlockedSessionActions({ projectId, sessionKey, blockedMessage }: { projectId: string; sessionKey: string; blockedMessage: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const toolBlocker = isToolBlocker(blockedMessage);

  async function actOnBlockedSession() {
    setPending(true);
    try {
      const action = toolBlocker ? "retry" : "escalate";
      const response = await fetch(`/api/projects/${projectId}/sessions/${encodeURIComponent(sessionKey)}/${action}`, { method: "POST" });
      const payload = await response.json() as { redirectTo?: string };
      router.push(payload.redirectTo ?? (toolBlocker ? `/projects/${projectId}` : `/projects/${projectId}?role=architect`));
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" color={toolBlocker ? "blue" : "red"} variant="light" size="xs" radius="xl" loading={pending} onClick={actOnBlockedSession}>
      {toolBlocker ? "Retry Codex" : "Send to Architect"}
    </Button>
  );
}

function lastAssistantMessage(session: AgentSessionRecord): string {
  const message = [...session.messages].reverse().find((item) => item.role === "assistant") ?? session.messages.at(-1);
  if (!message?.content) return session.currentStep ?? "This session is blocked, but no detailed reason was recorded.";
  return message.content;
}

function isToolBlocker(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("you've hit your usage limit")
    || normalized.includes("usage limit")
    || normalized.includes("not inside a trusted directory")
    || normalized.includes("http error: 401")
    || normalized.includes("missing bearer")
    || normalized.includes("codex error");
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function formatElapsed(value: string): string {
  const startedAt = new Date(value).getTime();
  if (Number.isNaN(startedAt)) return "0s";
  return formatDuration(Date.now() - startedAt).replace(" ", "");
}
