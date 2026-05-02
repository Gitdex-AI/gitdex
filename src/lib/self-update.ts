import { execFile } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SelfUpdateCommand = {
  command: "git pull" | "npm install" | "npm run build";
  bin: string;
  args: string[];
};

export type SelfUpdateCommandResult = {
  command: SelfUpdateCommand["command"];
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SelfUpdateRunResult = {
  ok: boolean;
  restartAvailable: boolean;
  results: SelfUpdateCommandResult[];
  failedCommand: SelfUpdateCommand["command"] | null;
};

export type SelfUpdateState = {
  enabled: boolean;
  restartAvailable: boolean;
  lastRun: SelfUpdateRunResult | null;
  trustedCallerAddressAvailable: boolean;
  trustedLocalhostCallerValidated: boolean;
  operatorSubmissionAvailable: boolean;
  operatorIntentToken: string | null;
  bootId: string;
  startedAt: string;
  restartStatus: "idle" | "requested" | "failed";
  restartError: string | null;
};

type CommandRunner = (command: SelfUpdateCommand, cwd: string) => Promise<SelfUpdateCommandResult>;
type RequestSource =
  | Headers
  | {
      headers: Headers;
      nextUrl?: {
        hostname?: string | null;
      } | null;
      url?: string | null;
      ip?: string | null;
      remoteAddress?: string | null;
    };

const updateCommands: SelfUpdateCommand[] = [
  { command: "git pull", bin: "git", args: ["pull"] },
  { command: "npm install", bin: "npm", args: ["install"] },
  { command: "npm run build", bin: "npm", args: ["run", "build"] }
];

export const selfUpdateOperatorNonceCookieName = "taskix_self_update_operator_nonce";

let restartAvailable = false;
let lastRun: SelfUpdateRunResult | null = null;
let commandRunner: CommandRunner = runCommand;
let restartStatus: SelfUpdateState["restartStatus"] = "idle";
let restartError: string | null = null;

const bootId = randomUUID();
const startedAt = new Date().toISOString();
const operatorIntentSecret = randomBytes(32).toString("hex");

export function isSelfUpdateEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.TASKIX_ENABLE_SELF_UPDATE === "true";
}

export function isLocalhostAddress(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const address = value.trim().toLowerCase();
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "[::1]" ||
    address === "::ffff:127.0.0.1" ||
    address === "[::ffff:127.0.0.1]"
  );
}

export function isLocalhostRequest(source: RequestSource) {
  return isLocalhostAddress(getTrustedCallerAddress(source));
}

export function hasTrustedCallerAddress(source: RequestSource) {
  return getTrustedCallerAddress(source) !== null;
}

export function getSelfUpdateState(source?: RequestSource): SelfUpdateState {
  return buildSelfUpdateState(source, mintSelfUpdateOperatorIntent());
}

export function buildSelfUpdateState(
  source: RequestSource | undefined,
  operatorIntent: ReturnType<typeof mintSelfUpdateOperatorIntent>
): SelfUpdateState {
  return {
    enabled: isSelfUpdateEnabled(),
    restartAvailable,
    lastRun,
    trustedCallerAddressAvailable: source ? hasTrustedCallerAddress(source) : false,
    trustedLocalhostCallerValidated: source ? isLocalhostRequest(source) : false,
    operatorSubmissionAvailable: operatorIntent !== null,
    operatorIntentToken: operatorIntent?.token ?? null,
    bootId,
    startedAt,
    restartStatus,
    restartError
  };
}

export function selfUpdateGuard(source: RequestSource) {
  if (!isSelfUpdateEnabled()) {
    return {
      ok: false as const,
      status: 403,
      error: "Self-update is disabled. Set TASKIX_ENABLE_SELF_UPDATE=true to enable it."
    };
  }

  if (!isLocalhostRequest(source)) {
    return {
      ok: false as const,
      status: 403,
      error: "Self-update endpoints only accept localhost requests."
    };
  }

  return { ok: true as const };
}

function getTrustedCallerAddress(source: RequestSource) {
  if (source instanceof Headers) {
    // Host and forwarding headers are caller-controlled in this route context, so header-only checks fail closed.
    return null;
  }

  return source.ip || source.remoteAddress || null;
}

export async function runSelfUpdate(cwd = process.cwd()): Promise<SelfUpdateRunResult> {
  const results: SelfUpdateCommandResult[] = [];
  restartAvailable = false;
  restartStatus = "idle";
  restartError = null;

  for (const command of updateCommands) {
    const result = await commandRunner(command, cwd);
    results.push(result);

    if (result.exitCode !== 0) {
      lastRun = {
        ok: false,
        restartAvailable: false,
        results,
        failedCommand: command.command
      };
      return lastRun;
    }
  }

  lastRun = {
    ok: true,
    restartAvailable: true,
    results,
    failedCommand: null
  };
  restartAvailable = true;
  return lastRun;
}

export async function runOperatorSelfUpdate(input: { nonce?: string | null; token?: string | null }, cwd = process.cwd()) {
  const guard = validateSelfUpdateOperatorIntent(input);
  if (!guard.ok) {
    return {
      ok: false as const,
      status: guard.status,
      error: guard.error,
      result: null
    };
  }

  const result = await runSelfUpdate(cwd);
  return {
    ok: result.ok,
    status: result.ok ? 200 : 500,
    error: result.ok ? null : `Self-update failed at ${result.failedCommand ?? "unknown command"}.`,
    result
  };
}

export function getSelfUpdateCommands() {
  return updateCommands.map(({ command }) => command);
}

export function consumeRestartAvailability() {
  if (!restartAvailable) {
    return false;
  }

  restartAvailable = false;
  return true;
}

export function mintSelfUpdateOperatorIntent() {
  if (!isSelfUpdateEnabled()) {
    return null;
  }

  const nonce = randomBytes(32).toString("base64url");
  return {
    token: signOperatorIntentNonce(nonce),
    cookie: {
      name: selfUpdateOperatorNonceCookieName,
      value: nonce,
      maxAge: 5 * 60
    }
  };
}

export function validateSelfUpdateOperatorIntent(input: { nonce?: string | null; token?: string | null }) {
  if (!isSelfUpdateEnabled()) {
    return {
      ok: false as const,
      status: 403,
      error: "Self-update is disabled. Set TASKIX_ENABLE_SELF_UPDATE=true to enable it."
    };
  }

  if (!input.nonce || !input.token) {
    return {
      ok: false as const,
      status: 403,
      error: "Self-update operator intent token is required."
    };
  }

  if (!constantTimeEqual(input.token, signOperatorIntentNonce(input.nonce))) {
    return {
      ok: false as const,
      status: 403,
      error: "Self-update operator intent token is invalid or expired."
    };
  }

  return { ok: true as const };
}

export function markSelfUpdateRestartRequested() {
  restartStatus = "requested";
  restartError = null;
}

export function markSelfUpdateRestartFailed(error: string) {
  restartStatus = "failed";
  restartError = error;
}

export function setSelfUpdateCommandRunnerForTests(runner: CommandRunner) {
  commandRunner = runner;
}

export function resetSelfUpdateStateForTests() {
  restartAvailable = false;
  lastRun = null;
  commandRunner = runCommand;
  restartStatus = "idle";
  restartError = null;
}

async function runCommand(command: SelfUpdateCommand, cwd: string): Promise<SelfUpdateCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command.bin, command.args, {
      cwd,
      maxBuffer: 1024 * 1024 * 10
    });

    return {
      command: command.command,
      exitCode: 0,
      stdout,
      stderr
    };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };

    return {
      command: command.command,
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: stringifyOutput(failure.stdout),
      stderr: stringifyOutput(failure.stderr) || failure.message || "Command failed."
    };
  }
}

function stringifyOutput(value: string | Buffer | undefined) {
  if (!value) {
    return "";
  }

  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function signOperatorIntentNonce(nonce: string) {
  return createHmac("sha256", operatorIntentSecret).update(nonce).digest("base64url");
}

function constantTimeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
