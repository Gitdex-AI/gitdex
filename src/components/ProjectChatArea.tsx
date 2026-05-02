"use client";

import { Alert, Badge, Button, Code, Group, Stack, Text, Textarea } from "@mantine/core";
import { AlertTriangle, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { chatRoleLabel, parseChatTarget } from "@/lib/chat-routing";
import type { AgentMessage, AgentSessionRecord, JobRecord } from "@/lib/types";

type TimelineMessage = AgentMessage & {
  kind: "message";
  sessionKey: string;
  sourceLabel: string;
  sourceRole: AgentSessionRecord["role"];
  session: AgentSessionRecord | null;
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
  inspectedSession,
  readOnly
}: {
  projectId: string;
  sessions: AgentSessionRecord[];
  jobs: JobRecord[];
  inspectedSession: AgentSessionRecord | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState<TimelineMessage | null>(null);
  const visibleSessions = readOnly && inspectedSession ? [inspectedSession] : sessions;

  useEffect(() => {
    setPending(false);
    setOptimisticMessage(null);
  }, [sessions, inspectedSession?.updatedAt, readOnly]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTop = scroll.scrollHeight;
  }, [visibleSessions, optimisticMessage?.createdAt, pending, jobs]);

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
      <div ref={scrollRef} className="chat-scroll">
        <MessageList projectId={projectId} sessions={visibleSessions} jobs={jobs} inspectedSession={readOnly ? inspectedSession : null} optimisticMessage={optimisticMessage} pending={pending} />
      </div>
      {!readOnly && (
        <div className="chat-composer">
          <form ref={formRef} method="post" action={`/api/projects/${projectId}/chat`} className="chat-composer-form" onSubmit={submitMessage}>
            <Textarea
              name="message"
              aria-label="Message project agents"
              placeholder="@PM clarify scope, @architect review the plan, @devops check deployment..."
              autosize
              minRows={2}
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
                    <Text size="xs" c="dimmed">Message sent. Codex agent is thinking...</Text>
                  </>
                ) : (
                  <Text size="xs" c="dimmed">
                    Default target <Code>PM</Code>
                  </Text>
                )}
              </div>
              <Button type="submit" radius="xl" leftSection={<Send size={16} />} loading={pending} disabled={pending}>
                {pending ? "Thinking" : "Send"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function RunningAgentStatus({ jobs, sessions }: { jobs: JobRecord[]; sessions: AgentSessionRecord[] }) {
  const runningJobs = jobs.filter((job) => job.status === "running");
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!runningJobs.length) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [runningJobs.length]);

  if (!runningJobs.length) return null;

  return (
    <div className="chat-message assistant pending" aria-live="polite">
      <div className="chat-avatar">A</div>
      <div className="chat-bubble running-agent-bubble">
        <Group gap="xs" mb={6} justify="space-between" align="center">
          <Badge variant="light">agent status</Badge>
          <Text component="time" dateTime={new Date().toISOString()} size="xs" c="dimmed">
            now
          </Text>
        </Group>
        <Stack gap={4}>
          {runningJobs.map((job) => {
            const session = findJobSession(job, sessions);
            const label = runningAgentLabel(job, session);
            const startedAt = job.runtime?.startedAt ?? job.updatedAt ?? job.createdAt;
            return (
              <Text key={job.jobId} size="sm" c="dimmed" className="running-agent-line">
                <LoaderCircle size={13} className="chat-composer-spinner" />
                <span>{label} thinking ...({formatElapsed(startedAt)})</span>
              </Text>
            );
          })}
        </Stack>
      </div>
    </div>
  );
}

function findJobSession(job: JobRecord, sessions: AgentSessionRecord[]): AgentSessionRecord | null {
  if (!job.payload.issueId) {
    if (job.type === "workflow_run") return sessions.find((session) => session.role === "architect" && session.workflowId === job.payload.workflowId) ?? null;
    return null;
  }
  const expectedRole = job.type === "qa_run" ? "qa" : "developer";
  return sessions.find((session) => session.role === expectedRole && session.issueId === job.payload.issueId) ?? null;
}

function runningAgentLabel(job: JobRecord, session: AgentSessionRecord | null): string {
  if (session?.developerRole) return session.developerRole;
  if (session?.role === "developer") return "Dev";
  if (session?.role === "qa") return "QA";
  if (session?.role === "architect") return "Architect";
  if (job.type === "issue_run") return "Dev";
  if (job.type === "qa_run") return "QA";
  if (job.type === "workflow_run") return "Architect";
  return "Agent";
}

function MessageList({
  projectId,
  sessions,
  jobs,
  inspectedSession,
  optimisticMessage,
  pending
}: {
  projectId: string;
  sessions: AgentSessionRecord[];
  jobs: JobRecord[];
  inspectedSession: AgentSessionRecord | null;
  optimisticMessage: TimelineMessage | null;
  pending: boolean;
}) {
  const messages = [
    ...sessions.flatMap((session) => session.messages.map((message) => ({
      ...message,
      kind: "message",
      sessionKey: session.sessionKey,
      sourceLabel: message.role === "user" ? `You → ${chatRoleLabel(session.role, session.title, session.developerRole)}` : chatRoleLabel(session.role, session.title, session.developerRole),
      sourceRole: session.role,
      session
    } satisfies TimelineMessage))),
    ...sessions.flatMap((session) => (session.executionLogs ?? []).map((log) => ({
      ...log,
      kind: "execution-log",
      sessionKey: session.sessionKey,
      sourceLabel: chatRoleLabel(session.role, session.title, session.developerRole),
      sourceRole: session.role,
      session
    } satisfies TimelineExecutionLog))),
    ...(optimisticMessage ? [optimisticMessage] : [])
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  const runningStatus = <RunningAgentStatus jobs={jobs} sessions={sessions} />;

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
                  </Group>
                  <Text component="time" dateTime={message.createdAt} size="xs" c="dimmed">
                    {formatMessageTime(message.createdAt)}
                  </Text>
                </Group>
                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{message.content}</Text>
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
            <Text size="sm" c="dimmed">Codex agent is thinking...</Text>
          </div>
        </div>
      )}
      {runningStatus}
    </Stack>
  );
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

function chatAvatarText(message: TimelineMessage | TimelineExecutionLog): string {
  if (message.kind === "message" && message.role === "user") return "U";
  if (message.sourceRole === "product_manager") return "PM";
  if (message.sourceRole === "architect") return "AR";
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
