import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { getJsonValue, setJsonValue } from "@/lib/db";
import { rootDir } from "@/lib/paths";
import type { Settings } from "@/lib/types";

export type CodexStatus = {
  ok: boolean;
  checkedAt: string;
  binary: string;
  codexHome: string;
  model: string;
  version: CheckResult;
  exec: CheckResult;
};

type CheckResult = {
  ok: boolean;
  command: string;
  output: string;
  error?: string;
};

export async function checkCodexStatus(settings: Settings): Promise<CodexStatus> {
  const version = await runCommand(settings.codexBin, ["--version"], 8_000, settings.codexHome);
  const exec = version.ok
    ? await runCommand(
        settings.codexBin,
        [
          "exec",
          "--skip-git-repo-check",
          ...codexPermissionArgs(settings.codexSandbox, settings.codexApprovalPolicy),
          "--model",
          settings.codexModel,
          "Reply with exactly: gitdex-codex-ok"
        ],
        20_000,
        settings.codexHome
      )
    : {
        ok: false,
        command: `${settings.codexBin} exec`,
        output: "",
        error: "Skipped because codex --version failed."
      };

  return {
    ok: version.ok && exec.ok,
    checkedAt: new Date().toISOString(),
    binary: settings.codexBin,
    codexHome: settings.codexHome,
    model: settings.codexModel,
    version,
    exec
  };
}

export function getCachedCodexStatus(): CodexStatus | null {
  return getJsonValue<CodexStatus>("codex_status");
}

export function saveCodexStatus(status: CodexStatus): void {
  setJsonValue("codex_status", status);
}

async function runCommand(command: string, args: string[], timeoutMs: number, codexHome: string): Promise<CheckResult> {
  await mkdir(codexHome, { recursive: true });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, CODEX_HOME: codexHome },
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

    let stdout = "";
    let stderr = "";
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
        error: code === 0 ? undefined : `Exited with code ${code}.`
      });
    });
  });
}

function compactOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").slice(0, 2_000);
}

function codexPermissionArgs(sandbox: string, approvalPolicy: string): string[] {
  if (approvalPolicy === "never" && sandbox === "danger-full-access") return ["--dangerously-bypass-approvals-and-sandbox"];
  return ["--sandbox", sandbox];
}
