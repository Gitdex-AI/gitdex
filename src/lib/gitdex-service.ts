import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitdexServiceManager = "systemctl" | "launchctl" | "pm2";

export type GitdexServiceRestartResult = {
  ok: boolean;
  manager: GitdexServiceManager | null;
  serviceName: string | null;
  stdout: string;
  stderr: string;
  error: string | null;
};

export type GitdexServiceRestartResponse = GitdexServiceRestartResult & {
  status: number;
  restartRequested: boolean;
};

type RestartCommand = {
  manager: GitdexServiceManager;
  bin: string;
  args: string[];
  serviceName: string;
};

type ServiceRestarter = (command: RestartCommand) => Promise<GitdexServiceRestartResult>;
type RestartGuardResult = { ok: true } | { ok: false; status: number; error: string };

let serviceRestarter: ServiceRestarter = runRestartCommand;

export async function requestGitdexServiceRestart<TSource>(input: {
  source: TSource;
  guard: (source: TSource) => RestartGuardResult;
  consumeRestartAvailability: () => boolean;
}): Promise<GitdexServiceRestartResponse> {
  const guard = input.guard(input.source);
  if (!guard.ok) {
    return {
      ok: false,
      status: guard.status,
      restartRequested: false,
      manager: null,
      serviceName: null,
      stdout: "",
      stderr: "",
      error: guard.error
    };
  }

  if (!input.consumeRestartAvailability()) {
    return {
      ok: false,
      status: 409,
      restartRequested: false,
      manager: null,
      serviceName: null,
      stdout: "",
      stderr: "",
      error: "Restart is not available until self-update completes successfully."
    };
  }

  const result = await restartGitdexService();
  return {
    ...result,
    status: result.ok ? 200 : result.manager ? 500 : 503,
    restartRequested: result.ok
  };
}

export async function restartGitdexService(env: NodeJS.ProcessEnv = process.env): Promise<GitdexServiceRestartResult> {
  const config = getGitdexServiceRestartCommand(env);
  if (!config.ok) {
    return {
      ok: false,
      manager: null,
      serviceName: null,
      stdout: "",
      stderr: "",
      error: config.error
    };
  }

  return serviceRestarter(config.command);
}

export function getGitdexServiceRestartCommand(env: NodeJS.ProcessEnv = process.env) {
  const manager = env.GITDEX_NEXT_SERVICE_MANAGER;
  const serviceName = env.GITDEX_NEXT_SERVICE_NAME?.trim() ?? "";

  if (!isGitdexServiceManager(manager)) {
    return {
      ok: false as const,
      error: "Gitdex service restart is not configured. Set GITDEX_NEXT_SERVICE_MANAGER to systemctl, launchctl, or pm2."
    };
  }

  if (!isGitdexServiceName(serviceName)) {
    return {
      ok: false as const,
      error: "Gitdex service restart requires GITDEX_NEXT_SERVICE_NAME to identify the Gitdex Next.js service."
    };
  }

  return {
    ok: true as const,
    command: buildRestartCommand(manager, serviceName)
  };
}

export function setGitdexServiceRestarterForTests(restarter: ServiceRestarter) {
  serviceRestarter = restarter;
}

export function resetGitdexServiceRestarterForTests() {
  serviceRestarter = runRestartCommand;
}

function buildRestartCommand(manager: GitdexServiceManager, serviceName: string): RestartCommand {
  if (manager === "systemctl") {
    return { manager, bin: "systemctl", args: ["restart", serviceName], serviceName };
  }

  if (manager === "launchctl") {
    return { manager, bin: "launchctl", args: ["kickstart", "-k", serviceName], serviceName };
  }

  return { manager, bin: "pm2", args: ["restart", serviceName], serviceName };
}

function isGitdexServiceManager(value: string | undefined): value is GitdexServiceManager {
  return value === "systemctl" || value === "launchctl" || value === "pm2";
}

function isGitdexServiceName(value: string) {
  // This endpoint is intentionally not a general service-control API.
  return /^[a-zA-Z0-9._:@-]+$/.test(value) && value.toLowerCase().includes("gitdex");
}

async function runRestartCommand(command: RestartCommand): Promise<GitdexServiceRestartResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command.bin, command.args, {
      maxBuffer: 1024 * 1024 * 2
    });

    return {
      ok: true,
      manager: command.manager,
      serviceName: command.serviceName,
      stdout,
      stderr,
      error: null
    };
  } catch (error) {
    const failure = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };

    return {
      ok: false,
      manager: command.manager,
      serviceName: command.serviceName,
      stdout: stringifyOutput(failure.stdout),
      stderr: stringifyOutput(failure.stderr),
      error: failure.message ?? "Gitdex service restart failed."
    };
  }
}

function stringifyOutput(value: string | Buffer | undefined) {
  if (!value) {
    return "";
  }

  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}
