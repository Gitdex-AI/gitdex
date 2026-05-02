"use client";

import { Button, Text } from "@mantine/core";
import { ClipboardCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectHandoffToQaButton({
  projectId,
  issueId
}: {
  projectId: string;
  issueId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handoffToQa() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${issueId}/handoff-to-qa`, { method: "POST" });
      const payload = await response.json() as { error?: string; jobId?: string };
      if (!response.ok) {
        setError(payload.error ?? "QA handoff failed");
        return;
      }
      if (payload.jobId) runQueuedJob(payload.jobId);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "QA handoff failed");
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
        const message = error instanceof Error ? error.message : "QA run failed";
        if (!message.includes("not pending")) setError(message);
      })
      .finally(() => {
        router.refresh();
      });
    window.setTimeout(() => router.refresh(), 500);
  }

  return (
    <>
      <Button type="button" variant="light" color="blue" size="compact-xs" radius="xl" leftSection={<ClipboardCheck size={14} />} loading={pending} onClick={handoffToQa}>
        Run QA
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
