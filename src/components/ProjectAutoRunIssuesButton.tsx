"use client";

import { Button, Group, Text } from "@mantine/core";
import { Pause, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { announceIssueAutoRunStart } from "@/components/ProjectAutoRunIssueAction";

export function ProjectAutoRunIssuesButton({ projectId, workflowIds, issueIds }: { projectId: string; workflowIds: string[]; issueIds: string[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");

  function autoRun() {
    setPending(true);
    setPaused(false);
    setError("");
    announceIssueAutoRunStart();
    void fetch(`/api/projects/${projectId}/issues/auto-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowIds, issueIds })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
        if (!response.ok) throw new Error(payload.error ?? "Auto Run failed.");
        if (payload.message?.toLowerCase().includes("paused")) setPaused(true);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Auto Run failed.");
      })
      .finally(() => {
        setPending(false);
        router.refresh();
      });
    window.setTimeout(() => router.refresh(), 500);
  }

  function control(action: "pause" | "cancel") {
    if (action === "cancel") {
      setPending(false);
      setPaused(false);
    }
    void fetch(`/api/projects/${projectId}/issues/auto-run/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Auto Run control failed.");
      })
      .finally(() => router.refresh());
  }

  return (
    <>
      <Group gap={4}>
        <Button type="button" variant="filled" size="compact-xs" radius="xl" leftSection={<Play size={14} />} loading={pending} onClick={autoRun}>
          {paused ? "Resume" : "Auto Run"}
        </Button>
        {pending ? (
          <Button type="button" variant="light" size="compact-xs" radius="xl" leftSection={<Pause size={14} />} onClick={() => control("pause")}>
            Pause
          </Button>
        ) : null}
        {(pending || paused) ? (
          <Button type="button" color="red" variant="light" size="compact-xs" radius="xl" leftSection={<Square size={14} />} onClick={() => control("cancel")}>
            Stop
          </Button>
        ) : null}
      </Group>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
