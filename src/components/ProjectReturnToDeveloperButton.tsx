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
      const payload = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok) {
        setError(payload.error ?? "Run Dev failed");
        return;
      }
      if (payload.redirectTo) router.push(payload.redirectTo);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Run Dev failed");
    } finally {
      setPending(false);
    }
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
