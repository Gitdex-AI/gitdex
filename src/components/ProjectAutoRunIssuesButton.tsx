"use client";

import { Button, Group, Text } from "@mantine/core";
import { Pause, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { announceIssueAutoRunStart } from "@/components/ProjectAutoRunIssueAction";
import type { AutoRunState, AutoRunStatus } from "@/lib/auto-run-control";

const runningStatuses = new Set<AutoRunStatus>(["running", "pause_requested", "cancel_requested"]);

export function ProjectAutoRunIssuesButton({
  projectId,
  workflowIds,
  issueIds,
  initialState
}: {
  projectId: string;
  workflowIds: string[];
  issueIds: string[];
  initialState: AutoRunState | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<AutoRunState | null>(initialState);
  const [error, setError] = useState("");
  const running = pending || runningStatuses.has(state?.status ?? "idle");
  const paused = state?.status === "paused";

  useEffect(() => {
    setState(initialState);
  }, [initialState]);

  useEffect(() => {
    if (!running && !paused) return;
    let cancelled = false;
    const refreshState = () => {
      void fetch(`/api/projects/${projectId}/issues/auto-run/control`)
        .then(async (response) => {
          const payload = await response.json().catch(() => ({})) as { state?: AutoRunState | null };
          if (!cancelled) {
            setState(payload.state ?? null);
            if (!runningStatuses.has(payload.state?.status ?? "idle")) setPending(false);
          }
        })
        .catch(() => {
          if (!cancelled) router.refresh();
        });
    };
    refreshState();
    const timer = window.setInterval(refreshState, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [paused, projectId, router, running]);

  function autoRun() {
    setPending(true);
    setState({
      runId: "starting",
      projectId,
      status: "running",
      workflowIds,
      issueIds,
      message: "Auto Run is starting.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    setError("");
    announceIssueAutoRunStart();
    void fetch(`/api/projects/${projectId}/issues/auto-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowIds, issueIds })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; state?: AutoRunState | null };
        if (!response.ok) throw new Error(payload.error ?? "Auto Run failed.");
        if (payload.state) setState(payload.state);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Auto Run failed.");
      })
      .finally(() => {
        setPending(false);
        router.refresh();
      });
    window.setTimeout(() => router.refresh(), 500);
  }

  function control(action: "pause" | "cancel") {
    if (action === "cancel") {
      setPending(false);
      setState((current) => current ? { ...current, status: "cancel_requested", message: "Auto Run cancel requested.", updatedAt: new Date().toISOString() } : current);
    } else {
      setState((current) => current ? { ...current, status: "pause_requested", message: "Auto Run pause requested.", updatedAt: new Date().toISOString() } : current);
    }
    void fetch(`/api/projects/${projectId}/issues/auto-run/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { error?: string; state?: AutoRunState | null };
        if (!response.ok) throw new Error(payload.error ?? "Auto Run control failed.");
        setState(payload.state ?? null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Auto Run control failed.");
      })
      .finally(() => router.refresh());
  }

  return (
    <>
      <Group gap={4}>
        <Button type="button" variant="filled" size="compact-xs" radius="xl" leftSection={<Play size={14} />} loading={running} disabled={running} onClick={autoRun}>
          {paused ? "Resume" : "Auto Run"}
        </Button>
        {running && state?.status !== "pause_requested" && state?.status !== "cancel_requested" ? (
          <Button type="button" variant="light" size="compact-xs" radius="xl" leftSection={<Pause size={14} />} onClick={() => control("pause")}>
            Pause
          </Button>
        ) : null}
        {(running || paused) ? (
          <Button type="button" color="red" variant="light" size="compact-xs" radius="xl" leftSection={<Square size={14} />} onClick={() => control("cancel")}>
            Stop
          </Button>
        ) : null}
      </Group>
      {error ? <Text size="xs" c="red" maw={220}>{error}</Text> : null}
    </>
  );
}
