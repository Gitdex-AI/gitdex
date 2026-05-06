"use client";

import { Button, Text } from "@mantine/core";
import { SearchCode } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectAnalyzeBlockerButton({
  projectId,
  issueId
}: {
  projectId: string;
  issueId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function analyzeBlocker() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${issueId}/analyze-blocker`, { method: "POST" });
      const payload = await response.json() as { error?: string; jobId?: string };
      if (!response.ok) {
        setError(payload.error ?? "Analyze failed");
        setPending(false);
        return;
      }
      if (payload.jobId) await runQueuedJob(payload.jobId);
      router.refresh();
      if (!payload.jobId) setPending(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analyze failed");
      setPending(false);
    }
  }

  async function runQueuedJob(jobId: string) {
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs/${jobId}/run`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Analyze failed";
      if (!message.includes("not pending")) {
        setError(message);
        setPending(false);
      }
    } finally {
      router.refresh();
    }
    window.setTimeout(() => router.refresh(), 500);
    window.setTimeout(() => setPending(false), 1800);
  }

  return (
    <>
      <Button type="button" variant="filled" size="compact-xs" radius="xl" leftSection={<SearchCode size={14} />} loading={pending} onClick={analyzeBlocker}>
        Analyze
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
