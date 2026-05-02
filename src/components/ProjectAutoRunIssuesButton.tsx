"use client";

import { Button, Text } from "@mantine/core";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { announceIssueAutoRunStart } from "@/components/ProjectAutoRunIssueAction";

export function ProjectAutoRunIssuesButton({ projectId, workflowIds, issueIds }: { projectId: string; workflowIds: string[]; issueIds: string[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function autoRun() {
    setPending(true);
    setError("");
    announceIssueAutoRunStart();
    void fetch(`/api/projects/${projectId}/issues/auto-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowIds, issueIds })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Auto Run failed.");
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

  return (
    <>
      <Button type="button" variant="filled" size="compact-xs" radius="xl" leftSection={<Play size={14} />} loading={pending} onClick={autoRun}>
        Auto Run
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
