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
      const payload = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok) {
        setError(payload.error ?? "QA handoff failed");
        return;
      }
      if (payload.redirectTo) router.push(payload.redirectTo);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "QA handoff failed");
    } finally {
      setPending(false);
    }
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
