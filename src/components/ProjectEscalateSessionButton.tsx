"use client";

import { Button, Text } from "@mantine/core";
import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectEscalateSessionButton({
  projectId,
  sessionKey,
  label = "Run Architect"
}: {
  projectId: string;
  sessionKey: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function escalateSession() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/sessions/${encodeURIComponent(sessionKey)}/escalate`, { method: "POST" });
      const payload = await response.json() as { error?: string; jobId?: string };
      if (!response.ok) {
        setError(payload.error ?? "Run Architect failed");
        return;
      }
      if (payload.jobId) runQueuedJob(payload.jobId);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Run Architect failed");
    } finally {
      setPending(false);
    }
  }

  function runQueuedJob(jobId: string) {
    void fetch(`/api/projects/${projectId}/jobs/${jobId}/run`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
      })
      .catch((caught: unknown) => {
        const message = caught instanceof Error ? caught.message : "Run Architect failed";
        if (!message.includes("not pending")) setError(message);
      })
      .finally(() => {
        router.refresh();
      });
    window.setTimeout(() => router.refresh(), 500);
  }

  return (
    <>
      <Button type="button" variant="filled" size="compact-xs" radius="xl" leftSection={<ShieldAlert size={14} />} loading={pending} onClick={escalateSession}>
        {label}
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
