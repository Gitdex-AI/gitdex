"use client";

import { Button, Text } from "@mantine/core";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectAutoRunIssuesButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function autoRun() {
    setPending(true);
    setError("");
    void fetch(`/api/projects/${projectId}/issues/auto-run`, { method: "POST" })
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
