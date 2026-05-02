"use client";

import { Button, Text } from "@mantine/core";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectRunDeveloperIssueButton({
  projectId,
  issueId
}: {
  projectId: string;
  issueId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function runDeveloperIssue() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${issueId}/run-dev`, { method: "POST" });
      const payload = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok) {
        setError(payload.error ?? "Run Dev failed");
        return;
      }
      if (payload.redirectTo) router.push(payload.redirectTo);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Run Dev failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="filled" size="compact-xs" radius="xl" leftSection={<Play size={14} />} loading={pending} onClick={runDeveloperIssue}>
        Run Dev
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
