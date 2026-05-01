"use client";

import { Alert, Badge, Button, Code, Group, Stack, Text, Textarea } from "@mantine/core";
import { AlertTriangle, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { AgentMessage, AgentSessionRecord, Role } from "@/lib/types";

type ChatRole = Extract<Role, "product_manager" | "architect" | "devops">;

export function ProjectChatArea({
  projectId,
  activeRole,
  session,
  readOnly
}: {
  projectId: string;
  activeRole: ChatRole;
  session: AgentSessionRecord | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [optimisticMessage, setOptimisticMessage] = useState<AgentMessage | null>(null);
  const target = activeRole === "product_manager" ? "PM" : activeRole === "architect" ? "Architect" : "DevOps";

  useEffect(() => {
    setPending(false);
    setOptimisticMessage(null);
  }, [session?.updatedAt, activeRole]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollTop = scroll.scrollHeight;
  }, [session?.sessionKey, session?.updatedAt, session?.messages.length, optimisticMessage?.createdAt, pending]);

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const message = String(formData.get("message") ?? "").trim();
    if (!message) return;

    setPending(true);
    setOptimisticMessage({ role: "user", content: message, createdAt: new Date().toISOString() });
    form.reset();

    const response = await fetch(form.action, {
      method: "POST",
      body: formData,
      redirect: "follow"
    });
    const destination = response.url ? new URL(response.url).pathname + new URL(response.url).search : `/projects/${projectId}?role=${activeRole}`;
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
        <MessageList projectId={projectId} session={session} optimisticMessage={optimisticMessage} pending={pending} />
      </div>
      {!readOnly && (
        <div className="chat-composer">
          <form ref={formRef} method="post" action={`/api/projects/${projectId}/chat`} className="chat-composer-form" onSubmit={submitMessage}>
            <input type="hidden" name="role" value={activeRole} />
            <Textarea
              name="message"
              aria-label={`Message ${target}`}
              placeholder="Describe the requirement, paste context, or ask for the next step..."
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
                    Sending to <Code>{target}</Code>
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

function MessageList({
  projectId,
  session,
  optimisticMessage,
  pending
}: {
  projectId: string;
  session: AgentSessionRecord | null;
  optimisticMessage: AgentMessage | null;
  pending: boolean;
}) {
  const messages = [...(session?.messages ?? []), ...(optimisticMessage ? [optimisticMessage] : [])];

  if (!messages.length) {
    return <Text c="dimmed" ta="center" mt="xl">No messages yet.</Text>;
  }

  return (
    <Stack gap="md">
      {session && <SessionRuntime projectId={projectId} session={session} />}
      <Text size="sm" c="dimmed" ta="center">Session ID: <Code>{session?.sessionId ?? "local context only"}</Code></Text>
      {messages.map((message, index) => (
        <div key={`${message.createdAt}-${index}`} className={`chat-message ${message.role}`}>
          <div className="chat-avatar">{message.role === "user" ? "U" : message.role === "assistant" ? "A" : "S"}</div>
          <div className="chat-bubble">
            <Group gap="xs" mb={6} justify="space-between" align="center">
              <Badge variant="light">{message.role}</Badge>
              <Text component="time" dateTime={message.createdAt} size="xs" c="dimmed">
                {formatMessageTime(message.createdAt)}
              </Text>
            </Group>
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{message.content}</Text>
          </div>
        </div>
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
    </Stack>
  );
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
