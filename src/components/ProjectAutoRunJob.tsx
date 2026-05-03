"use client";

import { Alert, Text } from "@mantine/core";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function ProjectAutoRunJob({
  projectId,
  enabled,
  redirectTo
}: {
  projectId: string;
  enabled: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const startedRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "running" | "failed">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;
    setStatus("running");

    fetch(`/api/projects/${projectId}/jobs/run`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        router.replace(redirectTo ?? `/projects/${projectId}`);
        router.refresh();
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Workflow job failed to start.");
        setStatus("failed");
      });
  }, [enabled, projectId, redirectTo, router]);

  if (!enabled || status === "idle") return null;

  if (status === "failed") {
    return (
      <Alert color="red" mb="sm">
        Failed to run workflow job: {error}
      </Alert>
    );
  }

  return (
    <Alert icon={<LoaderCircle size={16} className="chat-composer-spinner" />} mb="sm">
      <Text size="sm" fw={700}>Workflow job is running</Text>
      <Text size="xs" c="dimmed">Planner issue creation and agent execution may take a while.</Text>
    </Alert>
  );
}
