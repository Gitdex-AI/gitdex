"use client";

import { Button, Text } from "@mantine/core";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectRunJobBatchButton({
  projectId,
  jobIds,
  label = "Run All",
  disabledReason
}: {
  projectId: string;
  jobIds: string[];
  label?: string;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function runBatch() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs/run-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds })
      });
      if (!response.ok) throw new Error(await response.text());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Run all failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="light" size="compact-xs" radius="xl" leftSection={<Play size={14} />} loading={pending} disabled={!jobIds.length} onClick={runBatch} title={!jobIds.length ? disabledReason : undefined}>
        {label}
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
