"use client";

import { Button, Group, Text } from "@mantine/core";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type RunJobResponse = {
  ran: boolean;
  job: {
    jobId: string;
    type: string;
    status: string;
    error?: string | null;
  } | null;
};

export function ProjectRunJobsForm({
  projectId,
  label = "Run Jobs",
  disabled = false
}: {
  projectId: string;
  label?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageColor, setMessageColor] = useState<"dimmed" | "red" | "green">("dimmed");

  async function runJob() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/jobs/run`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());

      const result = await response.json() as RunJobResponse;
      if (!result.ran || !result.job) {
        setMessage("No pending jobs");
        setMessageColor("dimmed");
      } else if (result.job.status === "failed") {
        setMessage(result.job.error ? `Failed: ${result.job.error}` : `${result.job.type} failed`);
        setMessageColor("red");
      } else {
        setMessage(`${result.job.type} ${result.job.status}`);
        setMessageColor("green");
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Run Jobs request failed");
      setMessageColor("red");
    } finally {
      setPending(false);
    }
  }

  return (
    <Group gap={6} wrap="nowrap">
      <Button
        type="button"
        variant="light"
        size="xs"
        radius="xl"
        leftSection={<Play size={14} />}
        loading={pending}
        disabled={disabled}
        onClick={runJob}
      >
        {label}
      </Button>
      {message ? (
        <Text size="xs" c={messageColor} lineClamp={1} maw={180} title={message}>
          {message}
        </Text>
      ) : null}
    </Group>
  );
}
