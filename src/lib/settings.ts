import { getJsonValue, setJsonValue } from "@/lib/db";
import os from "node:os";
import path from "node:path";
import { dataDir } from "@/lib/paths";
import type { Settings } from "@/lib/types";

const legacyCodexHome = `${dataDir}/codex-home`;
const defaultCodexHome = path.join(os.homedir(), ".codex");

const defaults: Settings = {
  appBaseUrl: "http://localhost:8000",
  telegramBotToken: "",
  telegramWebhookSecret: "",
  codexBin: "codex",
  codexHome: defaultCodexHome,
  codexModel: "gpt-5.4",
  codexSandbox: "workspace-write",
  codexApprovalPolicy: "never",
  githubToken: "",
  githubRepo: "",
  githubApiUrl: "https://api.github.com",
  worktreeRetentionDays: 7,
  autoCleanupCompletedWorktrees: true,
  rebuildWorktreeOnEnvironmentBlocked: true
};

export async function getSettings(): Promise<Settings> {
  const runtime = getJsonValue<Partial<Settings>>("settings");
  const settings = { ...defaults, ...fromEnv(), ...runtime };
  const codexHome = !settings.codexHome || settings.codexHome === legacyCodexHome ? defaultCodexHome : settings.codexHome;
  return {
    ...settings,
    codexHome,
    worktreeRetentionDays: normalizeRetentionDays(settings.worktreeRetentionDays),
    autoCleanupCompletedWorktrees: settings.autoCleanupCompletedWorktrees !== false,
    rebuildWorktreeOnEnvironmentBlocked: settings.rebuildWorktreeOnEnvironmentBlocked !== false
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  setJsonValue("settings", settings);
}

function fromEnv(): Partial<Settings> {
  return compact({
    appBaseUrl: process.env.APP_BASE_URL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    codexBin: process.env.CODEX_BIN,
    codexHome: process.env.CODEX_HOME,
    codexModel: process.env.CODEX_MODEL,
    codexSandbox: process.env.CODEX_SANDBOX,
    codexApprovalPolicy: process.env.CODEX_APPROVAL_POLICY,
    githubToken: process.env.GITHUB_TOKEN,
    githubRepo: process.env.GITHUB_REPO,
    githubApiUrl: process.env.GITHUB_API_URL,
    worktreeRetentionDays: process.env.WORKTREE_RETENTION_DAYS,
    autoCleanupCompletedWorktrees: process.env.AUTO_CLEANUP_COMPLETED_WORKTREES,
    rebuildWorktreeOnEnvironmentBlocked: process.env.REBUILD_WORKTREE_ON_ENVIRONMENT_BLOCKED
  });
}

function compact<T extends Record<string, string | undefined>>(input: T): Partial<Settings> {
  const entries = Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => {
      if (key === "worktreeRetentionDays") return [key, normalizeRetentionDays(Number(value))];
      if (key === "autoCleanupCompletedWorktrees" || key === "rebuildWorktreeOnEnvironmentBlocked") return [key, value !== "false"];
      return [key, value];
    });
  return Object.fromEntries(entries) as Partial<Settings>;
}

function normalizeRetentionDays(value: unknown): number {
  const days = Number(value);
  if (!Number.isFinite(days)) return defaults.worktreeRetentionDays;
  return Math.max(1, Math.min(365, Math.round(days)));
}
