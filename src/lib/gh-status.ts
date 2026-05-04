import { spawn } from "node:child_process";
import { getJsonValue, setJsonValue } from "@/lib/db";
import { rootDir } from "@/lib/paths";

export type GhStatus = {
  ok: boolean;
  checkedAt: string;
  version: CheckResult;
  auth: CheckResult;
  user: CheckResult;
};

type CheckResult = {
  ok: boolean;
  command: string;
  output: string;
  error?: string;
};

export async function checkGhStatus(): Promise<GhStatus> {
  const version = await runCommand("gh", ["--version"], 8_000);
  const auth = version.ok ? await runCommand("gh", ["auth", "status"], 8_000) : skipped("gh auth status", "Skipped because gh --version failed.");
  const user = auth.ok ? await runCommand("gh", ["api", "user", "--jq", ".login"], 8_000) : skipped("gh api user --jq .login", "Skipped because gh auth status failed.");

  return {
    ok: version.ok && auth.ok && user.ok,
    checkedAt: new Date().toISOString(),
    version,
    auth,
    user
  };
}

export function getCachedGhStatus(): GhStatus | null {
  return getJsonValue<GhStatus>("gh_status");
}

export function saveGhStatus(status: GhStatus): void {
  setJsonValue("gh_status", status);
}

export async function resolveGhUserLogin(): Promise<string | null> {
  const cached = getCachedGhStatus();
  if (cached?.ok && cached.user.output.trim()) return cached.user.output.trim();
  try {
    const status = await checkGhStatus();
    saveGhStatus(status);
    return status.ok && status.user.output.trim() ? status.user.output.trim() : null;
  } catch {
    return null;
  }
}

function skipped(command: string, error: string): CheckResult {
  return { ok: false, command, output: "", error };
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        ok: false,
        command: [command, ...args].join(" "),
        output: compactOutput(stdout, stderr),
        error: `Timed out after ${timeoutMs}ms.`
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        command: [command, ...args].join(" "),
        output: compactOutput(stdout, stderr),
        error: error.message
      });
    });
    child.on("close", (code) => {
      finish({
        ok: code === 0,
        command: [command, ...args].join(" "),
        output: compactOutput(stdout, stderr),
        error: code === 0 ? undefined : `Exited with code ${code}. Run gh auth login to authenticate.`
      });
    });
  });
}

function compactOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(0, 2_000);
}
