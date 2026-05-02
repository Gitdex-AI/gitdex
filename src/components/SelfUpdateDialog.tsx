"use client";

import { Alert, Badge, Button, Code, Group, Modal, Stack, Text } from "@mantine/core";
import { RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SelfUpdateRunResult, SelfUpdateState } from "@/lib/self-update";
import { deriveSelfUpdateDialogModel, deriveSelfUpdatePollDecision, type SelfUpdateDialogPhase } from "@/lib/self-update-ui";

const pollIntervalMs = 2_000;
const pollTimeoutMs = 60_000;

type ApiFailure = {
  error?: string;
  stderr?: string;
};

export function SelfUpdateDialog({ version }: { version: string }) {
  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState<SelfUpdateDialogPhase>("idle");
  const [status, setStatus] = useState<SelfUpdateState | null>(null);
  const [error, setError] = useState("");
  const pollStartedAt = useRef(0);

  const model = useMemo(() => deriveSelfUpdateDialogModel({ phase, status, error }), [phase, status, error]);

  useEffect(() => {
    if (!opened) return;

    let cancelled = false;
    setPhase("loading");
    setError("");
    void loadStatus().then((nextStatus) => {
      if (cancelled) return;
      setStatus(nextStatus);
      setPhase("idle");
    }).catch((caught: unknown) => {
      if (cancelled) return;
      setError(toErrorMessage(caught, "Unable to load self-update status."));
      setPhase("failure");
    });

    return () => {
      cancelled = true;
    };
  }, [opened]);

  useEffect(() => {
    if (phase !== "polling") return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void pollStatus();
    }, pollIntervalMs);

    void pollStatus();

    async function pollStatus() {
      const elapsedMs = Date.now() - pollStartedAt.current;
      try {
        const nextStatus = await loadStatus();
        if (cancelled) return;
        setStatus(nextStatus);
        const decision = deriveSelfUpdatePollDecision({
          responseOk: true,
          status: nextStatus,
          elapsedMs,
          timeoutMs: pollTimeoutMs
        });
        setError(decision.phase === "timeout" ? decision.message : "");
        setPhase(decision.phase);
      } catch {
        if (cancelled) return;
        const decision = deriveSelfUpdatePollDecision({
          responseOk: false,
          status: null,
          elapsedMs,
          timeoutMs: pollTimeoutMs
        });
        setError(decision.phase === "timeout" ? decision.message : "");
        setPhase(decision.phase);
      }
    }

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase]);

  async function startUpdate() {
    setError("");
    setPhase("updating");
    try {
      const updateResult = await postJson<SelfUpdateRunResult>("/api/self-update/update");
      setStatus((current) => current ? { ...current, lastRun: updateResult, restartAvailable: updateResult.restartAvailable } : current);
      if (!updateResult.ok) throw new Error(`Self-update failed at ${updateResult.failedCommand ?? "unknown command"}.`);

      setPhase("restarting");
      await postJson("/api/self-update/restart");

      pollStartedAt.current = Date.now();
      setPhase("polling");
    } catch (caught) {
      setError(toErrorMessage(caught, "Self-update failed."));
      setPhase("failure");
      try {
        setStatus(await loadStatus());
      } catch {
        // Keep the original failure visible if status refresh also fails.
      }
    }
  }

  return (
    <>
      <button className="topbar-version" type="button" aria-label={`Taskix version ${version}. Open self-update dialog`} onClick={() => setOpened(true)}>
        v{version}
      </button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Taskix self-update" centered size="lg">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" gap="sm">
            <Stack gap={2}>
              <Text fw={700}>Current version</Text>
              <Code>v{version}</Code>
            </Stack>
            <Badge color={badgeColor(model.phase)} variant="light">
              {model.phase}
            </Badge>
          </Group>

          <Alert color={alertColor(model.phase)} title="Update status">
            <Text size="sm">{model.message}</Text>
          </Alert>

          <Stack gap={4}>
            <Text size="sm" fw={700}>Server integration</Text>
            <Text size="sm" c="dimmed">
              Self-update API {status?.enabled ? "enabled" : "disabled"}; restart {status?.restartAvailable ? "available" : "not available"}.
            </Text>
            <Text size="sm" c="dimmed">
              Trusted localhost validation {status?.trustedLocalhostCallerValidated ? "passed" : "not confirmed"}.
            </Text>
          </Stack>

          {status?.lastRun ? (
            <Stack gap={4}>
              <Text size="sm" fw={700}>Last run</Text>
              <Text size="sm" c={status.lastRun.ok ? "green" : "red"}>
                {status.lastRun.ok ? "Completed successfully" : `Failed at ${status.lastRun.failedCommand ?? "unknown command"}`}
              </Text>
            </Stack>
          ) : null}

          <Group justify="flex-end">
            <Button type="button" variant="default" onClick={() => setOpened(false)}>
              Close
            </Button>
            <Button
              type="button"
              leftSection={model.shouldPoll ? <RotateCcw size={16} /> : <RefreshCw size={16} />}
              loading={model.actionDisabled}
              disabled={!model.canSubmit}
              onClick={startUpdate}
            >
              Update and restart
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

async function loadStatus() {
  const response = await fetch("/api/self-update", { cache: "no-store" });
  if (!response.ok) throw new Error(await readApiError(response));
  return response.json() as Promise<SelfUpdateState>;
}

async function postJson<T = unknown>(url: string) {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) throw new Error(await readApiError(response));
  return response.json() as Promise<T>;
}

async function readApiError(response: Response) {
  try {
    const body = (await response.json()) as ApiFailure;
    return body.error || body.stderr || response.statusText;
  } catch {
    return response.statusText;
  }
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function badgeColor(phase: SelfUpdateDialogPhase) {
  if (phase === "success") return "green";
  if (phase === "failure" || phase === "timeout") return "red";
  if (phase === "polling" || phase === "restarting" || phase === "updating") return "blue";
  return "gray";
}

function alertColor(phase: SelfUpdateDialogPhase) {
  if (phase === "success") return "green";
  if (phase === "failure" || phase === "timeout") return "red";
  return "blue";
}
