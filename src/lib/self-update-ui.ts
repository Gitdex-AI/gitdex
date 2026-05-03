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
  initialBootId: string | null;
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
      phase: "success" | "failure" | "timeout";
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
  const operatorSubmissionAvailable = input.status?.operatorSubmissionAvailable ?? false;
  const restartAvailable = input.status?.restartAvailable ?? false;
  const canSubmit = enabled && !actionDisabled && (restartAvailable || operatorSubmissionAvailable);
  const unavailableReason = !enabled
    ? "Self-update is disabled. Set TASKIX_ENABLE_SELF_UPDATE=true on the Taskix server to enable it."
    : !operatorSubmissionAvailable && !restartAvailable
      ? "Operator self-update submission is not available for this UI session."
      : "";

  const message = input.error || unavailableReason || phaseMessage(input.phase, input.status);

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
  if (input.responseOk && input.status?.restartStatus === "failed") {
    return {
      phase: "failure",
      shouldContinue: false,
      message: input.status.restartError || "Taskix service restart failed."
    };
  }

  if (input.elapsedMs >= input.timeoutMs) {
    return {
      phase: "timeout",
      shouldContinue: false,
      message: "Restart polling timed out before Taskix reported ready."
    };
  }

  if (input.responseOk && input.status && input.initialBootId && input.status.bootId !== input.initialBootId) {
    return {
      phase: "success",
      shouldContinue: false,
      message: "Taskix reported a new boot marker after the restart request."
    };
  }

  return {
    phase: "polling",
    shouldContinue: true,
    message: input.responseOk
      ? "Waiting for Taskix to finish restarting."
      : "Waiting for Taskix to respond after restart."
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
      return "Waiting for Taskix to finish restarting.";
    case "success":
      return "Taskix reported a new boot marker after the restart request.";
    case "failure":
      return status?.restartError || "Self-update failed.";
    case "timeout":
      return "Restart polling timed out before Taskix reported ready.";
    case "idle":
      if (status?.restartAvailable) return "Self-update completed successfully. Restart is available when you confirm it.";
      if (status?.lastRun?.ok) return "Last self-update completed successfully. Restart is available until it is requested.";
      if (status?.lastRun && !status.lastRun.ok) return `Last self-update failed at ${status.lastRun.failedCommand}.`;
      return "Ready to check for updates.";
  }
}
