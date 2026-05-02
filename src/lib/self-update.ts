import { execFile } from "node:child_process";
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
};

type CommandRunner = (command: SelfUpdateCommand, cwd: string) => Promise<SelfUpdateCommandResult>;

const updateCommands: SelfUpdateCommand[] = [
  { command: "git pull", bin: "git", args: ["pull"] },
  { command: "npm install", bin: "npm", args: ["install"] },
  { command: "npm run build", bin: "npm", args: ["run", "build"] }
];

let restartAvailable = false;
let lastRun: SelfUpdateRunResult | null = null;
let commandRunner: CommandRunner = runCommand;

export function isSelfUpdateEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.TASKIX_ENABLE_SELF_UPDATE === "true";
}

export function isLocalhostAddress(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const address = value.trim().toLowerCase();
  return (
    address === "localhost" ||
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "[::1]" ||
    address === "::ffff:127.0.0.1" ||
    address === "[::ffff:127.0.0.1]"
  );
}

export function isLocalhostRequest(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstForwardedAddress = forwardedFor.split(",")[0]?.trim();
    if (!isLocalhostAddress(firstForwardedAddress)) {
      return false;
    }
  }

  return (
    isLocalhostAddress(headers.get("x-real-ip")) ||
    isLocalhostAddress(forwardedFor?.split(",")[0])
  );
}

export function getSelfUpdateState(): SelfUpdateState {
  return {
    enabled: isSelfUpdateEnabled(),
    restartAvailable,
    lastRun
  };
}

export function selfUpdateGuard(headers: Headers) {
  if (!isSelfUpdateEnabled()) {
    return {
      ok: false as const,
      status: 403,
      error: "Self-update is disabled. Set TASKIX_ENABLE_SELF_UPDATE=true to enable it."
    };
  }

  if (!isLocalhostRequest(headers)) {
    return {
      ok: false as const,
      status: 403,
      error: "Self-update endpoints only accept localhost requests."
    };
  }

  return { ok: true as const };
}

export async function runSelfUpdate(cwd = process.cwd()): Promise<SelfUpdateRunResult> {
  const results: SelfUpdateCommandResult[] = [];
  restartAvailable = false;

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

export function setSelfUpdateCommandRunnerForTests(runner: CommandRunner) {
  commandRunner = runner;
}

export function resetSelfUpdateStateForTests() {
  restartAvailable = false;
  lastRun = null;
  commandRunner = runCommand;
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
