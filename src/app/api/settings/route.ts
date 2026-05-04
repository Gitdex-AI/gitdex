import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import type { Settings } from "@/lib/types";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: Request) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const form = await request.formData();
  const next = safeNextPath(form.get("next"), "/");
  const current = await getSettings();
  const settings: Settings = {
    appBaseUrl: String(form.get("appBaseUrl") ?? "http://localhost:8000").trim(),
    telegramBotToken: String(form.get("telegramBotToken") ?? "").trim(),
    telegramWebhookSecret: String(form.get("telegramWebhookSecret") ?? "").trim(),
    codexBin: String(form.get("codexBin") ?? "codex").trim(),
    codexHome: String(form.get("codexHome") ?? "").trim(),
    codexModel: String(form.get("codexModel") ?? "gpt-5.4").trim(),
    codexSandbox: String(form.get("codexSandbox") ?? "workspace-write").trim(),
    codexApprovalPolicy: String(form.get("codexApprovalPolicy") ?? "never").trim(),
    githubToken: String(form.get("githubToken") ?? "").trim(),
    githubRepo: String(form.get("githubRepo") ?? "").trim(),
    githubApiUrl: String(form.get("githubApiUrl") ?? "https://api.github.com").trim(),
    worktreeRetentionDays: normalizeRetentionDays(form.get("worktreeRetentionDays")),
    autoCleanupCompletedWorktrees: form.get("autoCleanupCompletedWorktrees") === "on",
    rebuildWorktreeOnEnvironmentBlocked: form.get("rebuildWorktreeOnEnvironmentBlocked") === "on"
  };
  await saveSettings(settings);
  return redirectWithMessage(request, next, "message", "Settings saved.");
}

function normalizeRetentionDays(value: FormDataEntryValue | null): number {
  const days = Number(value);
  if (!Number.isFinite(days)) return 7;
  return Math.max(1, Math.min(365, Math.round(days)));
}

function safeNextPath(value: FormDataEntryValue | null, fallback: string): string {
  const next = String(value ?? "").trim();
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

function redirectWithMessage(request: Request, path: string, key: "message" | "error", value: string): NextResponse {
  const next = new URL(path, request.url);
  next.searchParams.set(key, value);
  return NextResponse.redirect(next, { status: 303 });
}
