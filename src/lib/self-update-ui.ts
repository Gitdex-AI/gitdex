import type { SelfUpdateState } from "@/lib/self-update";

export type SelfUpdateDialogPhase = "idle" | "loading" | "updating" | "restarting" | "polling" | "success" | "failure" | "timeout";

export type SelfUpdateDialogModel = {
  phase: SelfUpdateDialogPhase;
  status: SelfUpdateState | null;
  message: string;
  actionDisabled: boolean;
  canSubmit: boolean;
  shouldPoll: boolean;
};

export type SelfUpdatePollInput = {
  responseOk: boolean;
  status: SelfUpdateState | null;
  elapsedMs: number;
  timeoutMs: number;
};

export type SelfUpdatePollDecision =
  | {
      phase: "polling";
      shouldContinue: true;
      message: string;
    }
  | {
      phase: "success" | "timeout";
      shouldContinue: false;
      message: string;
    };

const runningPhases = new Set<SelfUpdateDialogPhase>(["loading", "updating", "restarting", "polling"]);

export function deriveSelfUpdateDialogModel(input: {
  phase: SelfUpdateDialogPhase;
  status: SelfUpdateState | null;
  error?: string;
}): SelfUpdateDialogModel {
  const actionDisabled = runningPhases.has(input.phase);
  const enabled = input.status?.enabled ?? false;
  const canSubmit = enabled && !actionDisabled;
  const unavailableReason = enabled
    ? ""
    : "Self-update is disabled. Set TASKIX_ENABLE_SELF_UPDATE=true on the Taskix server to enable it.";

  const message = input.error || phaseMessage(input.phase, input.status) || unavailableReason;

  return {
    phase: input.phase,
    status: input.status,
    message,
    actionDisabled,
    canSubmit,
    shouldPoll: input.phase === "polling"
  };
}

export function deriveSelfUpdatePollDecision(input: SelfUpdatePollInput): SelfUpdatePollDecision {
  if (input.elapsedMs >= input.timeoutMs) {
    return {
      phase: "timeout",
      shouldContinue: false,
      message: "Restart polling timed out before Taskix reported ready."
    };
  }

  if (input.responseOk && input.status) {
    return {
      phase: "success",
      shouldContinue: false,
      message: "Taskix is responding after the restart request."
    };
  }

  return {
    phase: "polling",
    shouldContinue: true,
    message: "Waiting for Taskix to respond after restart."
  };
}

function phaseMessage(phase: SelfUpdateDialogPhase, status: SelfUpdateState | null) {
  switch (phase) {
    case "loading":
      return "Checking self-update status.";
    case "updating":
      return "Running git pull, npm install, and production build.";
    case "restarting":
      return "Requesting Taskix service restart.";
    case "polling":
      return "Waiting for Taskix to respond after restart.";
    case "success":
      return "Taskix is responding after the restart request.";
    case "failure":
      return "Self-update failed.";
    case "timeout":
      return "Restart polling timed out before Taskix reported ready.";
    case "idle":
      if (status?.lastRun?.ok) return "Last self-update completed successfully. Restart is available until it is requested.";
      if (status?.lastRun && !status.lastRun.ok) return `Last self-update failed at ${status.lastRun.failedCommand}.`;
      return "Ready to check for updates and restart Taskix.";
  }
}
