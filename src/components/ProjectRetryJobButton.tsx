"use client";

import { Button, Text } from "@mantine/core";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectRetryJobButton({
  projectId,
  jobId,
  status = "failed"
}: {
  projectId: string;
  jobId: string;
  status?: "failed" | "running";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function retryJob() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs/${jobId}/retry`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Job recovery failed.");
    } finally {
      setPending(false);
    }
  }

  const label = status === "running" ? "Recover" : "Retry";

  return (
    <>
      <Button type="button" variant="light" color={status === "running" ? "orange" : "red"} size="compact-xs" radius="xl" leftSection={<RotateCcw size={14} />} loading={pending} onClick={retryJob}>
        {label}
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
