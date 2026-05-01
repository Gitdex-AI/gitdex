"use client";

import { Button, Text, Textarea } from "@mantine/core";
import { GitBranch, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import type { PmHandoffPayload } from "@/lib/pm-handoff";

export function ProjectHandoffForm({ projectId, payload }: { projectId: string; payload: PmHandoffPayload | null }) {
  if (!payload) {
    return (
      <form method="post" action={`/api/projects/${projectId}/handoff`} className="handoff-form">
        <DirectRequirementFields />
      </form>
    );
  }

  return (
    <form method="post" action={`/api/projects/${projectId}/handoff`} className="handoff-form">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <HandoffButton payload={payload} />
    </form>
  );
}

function DirectRequirementFields() {
  const { pending } = useFormStatus();

  return (
    <div className="handoff-box muted">
      <Text size="sm" fw={700}>Minimal Planning Smoke Path</Text>
      <Text size="xs" c="dimmed">
        Paste one confirmed requirement to queue a single architect planning workflow. This is a lightweight smoke path, not the full PM authoring flow.
      </Text>
      <Textarea
        name="requirement"
        aria-label="Direct workflow requirement"
        placeholder="Describe the confirmed requirement the architect should plan..."
        autosize
        minRows={3}
        maxRows={6}
        mt="xs"
        required
        disabled={pending}
      />
      <Button
        type="submit"
        fullWidth
        mt="sm"
        radius="xl"
        variant="light"
        leftSection={pending ? <LoaderCircle size={15} className="chat-composer-spinner" /> : <GitBranch size={15} />}
        disabled={pending}
      >
        {pending ? "Queueing workflow..." : "Queue Planning Workflow"}
      </Button>
      <Text size="xs" c="dimmed" mt="xs">
        After submit, Taskix returns to the architect view with the queued workflow and pending `workflow_run` job highlighted.
      </Text>
    </div>
  );
}

function HandoffButton({ payload }: { payload: PmHandoffPayload }) {
  const { pending } = useFormStatus();

  return (
    <div className="handoff-box">
      <Text size="sm" fw={700}>Start Workflow</Text>
      <Text size="xs" c="dimmed">
        PM marked this requirement ready. Queue one planning workflow from the confirmed handoff.
      </Text>
      <Text size="sm" fw={720} mt="xs" lineClamp={2}>{payload.requirement}</Text>
      <Button
        type="submit"
        fullWidth
        mt="sm"
        radius="xl"
        variant="filled"
        leftSection={pending ? <LoaderCircle size={15} className="chat-composer-spinner" /> : <GitBranch size={15} />}
        disabled={pending}
      >
        {pending ? "Queueing workflow..." : "Queue Workflow"}
      </Button>
    </div>
  );
}
