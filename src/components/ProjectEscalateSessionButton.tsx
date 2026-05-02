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
      const payload = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok) {
        setError(payload.error ?? "Run Architect failed");
        return;
      }
      router.push(payload.redirectTo ?? `/projects/${projectId}?role=architect`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Run Architect failed");
    } finally {
      setPending(false);
    }
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
