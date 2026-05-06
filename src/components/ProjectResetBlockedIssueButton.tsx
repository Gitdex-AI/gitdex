"use client";

import { Button, Text } from "@mantine/core";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectResetBlockedIssueButton({
  projectId,
  issueId
}: {
  projectId: string;
  issueId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function resetIssue() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${issueId}/reset-to-dev`, { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Reset failed");
        return;
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reset failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="light"
        color="gray"
        size="compact-xs"
        radius="xl"
        leftSection={<RotateCcw size={14} />}
        loading={pending}
        title="Reset blocked issue to Dev"
        aria-label="Reset blocked issue to Dev"
        onClick={resetIssue}
      >
        Reset
      </Button>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
