"use client";

import { Button, Group, Text } from "@mantine/core";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncResponse = {
  synced: number;
};

export function ProjectSyncForm({
  projectId,
  label = "Sync GitHub",
  compact = false
}: {
  projectId: string;
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageColor, setMessageColor] = useState<"dimmed" | "red" | "green">("dimmed");

  async function sync() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/sync`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());

      const result = await response.json() as SyncResponse;
      if (result.synced > 0) {
        setMessage(`Synced ${result.synced} workflow${result.synced === 1 ? "" : "s"}`);
        setMessageColor("green");
      } else {
        setMessage("Nothing to sync");
        setMessageColor("dimmed");
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitHub sync failed");
      setMessageColor("red");
    } finally {
      setPending(false);
    }
  }

  return (
    <Group gap={6} wrap="nowrap">
      <Button type="button" variant="light" size="xs" radius="xl" leftSection={<RefreshCw size={14} />} loading={pending} onClick={sync}>
        {compact ? "Sync" : label}
      </Button>
      {message ? (
        <Text size="xs" c={messageColor} lineClamp={1} maw={180} title={message}>
          {message}
        </Text>
      ) : null}
    </Group>
  );
}
