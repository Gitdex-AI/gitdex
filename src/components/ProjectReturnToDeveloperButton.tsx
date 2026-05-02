"use client";

import { Button, Text } from "@mantine/core";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectReturnToDeveloperButton({
  projectId,
  issueId
}: {
  projectId: string;
  issueId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function returnToDeveloper() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${issueId}/return-to-developer`, { method: "POST" });
      const payload = await response.json() as { error?: string; jobId?: string };
      if (!response.ok) {
        setError(payload.error ?? "Run Dev failed");
        return;
      }
      if (payload.jobId) runQueuedJob(payload.jobId);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Run Dev failed");
    } finally {
      setPending(false);
    }
  }

  function runQueuedJob(jobId: string) {
    void fetch(`/api/projects/${projectId}/jobs/${jobId}/run`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Run Dev failed";
        if (!message.includes("not pending")) setError(message);
      })
      .finally(() => {
        router.refresh();
      });
    window.setTimeout(() => router.refresh(), 500);
  }

  return (
    <>
      <Button type="button" variant="light" color="orange" size="compact-xs" radius="xl" leftSection={<RotateCcw size={14} />} loading={pending} onClick={returnToDeveloper}>
        Run Dev
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
