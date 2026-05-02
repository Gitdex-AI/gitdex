"use client";

import { Button, Code, Text, Textarea } from "@mantine/core";
import { LoaderCircle, Send } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";
import type { Role } from "@/lib/types";

export function ProjectChatComposer({ projectId, activeRole }: { projectId: string; activeRole: Extract<Role, "product_manager" | "architect" | "devops"> }) {
  return (
    <div className="chat-composer">
      <form method="post" action={`/api/projects/${projectId}/chat`} className="chat-composer-form">
        <input type="hidden" name="role" value={activeRole} />
        <ComposerFields activeRole={activeRole} />
      </form>
    </div>
  );
}

function ComposerFields({ activeRole }: { activeRole: Extract<Role, "product_manager" | "architect" | "devops"> }) {
  const { pending } = useFormStatus();
  const target = activeRole === "product_manager" ? "PM" : activeRole === "architect" ? "Architect" : "DevOps";

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || pending) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <>
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
              <Text size="xs" c="dimmed">Sending. Codex agent is working...</Text>
            </>
          ) : (
            <Text size="xs" c="dimmed">
              Sending to <Code>{target}</Code>
            </Text>
          )}
        </div>
        <Button type="submit" radius="xl" leftSection={<Send size={16} />} loading={pending} disabled={pending}>
          {pending ? "Working" : "Send"}
        </Button>
      </div>
    </>
  );
}
