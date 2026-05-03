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
      <Text size="sm" fw={700}>Confirm Requirement</Text>
      <Text size="xs" c="dimmed">
        Paste one confirmed requirement to assign a requirement number and send it to planner.
      </Text>
      <Textarea
        name="requirement"
        aria-label="Direct workflow requirement"
        placeholder="Describe the confirmed requirement the planner should break into issues..."
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
        {pending ? "Confirming..." : "Confirm Requirement"}
      </Button>
      <Text size="xs" c="dimmed" mt="xs">
        After submit, Taskix assigns a requirement number and queues planner work.
      </Text>
    </div>
  );
}

function HandoffButton({ payload }: { payload: PmHandoffPayload }) {
  const { pending } = useFormStatus();

  return (
    <div className="handoff-box">
      <Text size="sm" fw={700}>Confirm Requirement</Text>
      <Text size="xs" c="dimmed">
        PM marked this requirement ready. Confirm it to assign a requirement number and hand it to the planner.
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
        {pending ? "Confirming..." : "Confirm Requirement"}
      </Button>
    </div>
  );
}
