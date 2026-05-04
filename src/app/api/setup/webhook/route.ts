import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { TelegramClient } from "@/lib/telegram";
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
    githubUsername: current.githubUsername,
    githubSshPrivateKeyPath: current.githubSshPrivateKeyPath,
    githubSshPublicKey: current.githubSshPublicKey,
    worktreeRetentionDays: current.worktreeRetentionDays,
    autoCleanupCompletedWorktrees: current.autoCleanupCompletedWorktrees,
    rebuildWorktreeOnEnvironmentBlocked: current.rebuildWorktreeOnEnvironmentBlocked
  };
  await saveSettings(settings);

  if (!settings.telegramBotToken) {
    return redirectWithMessage(request, next, "error", "Missing Telegram bot token.");
  }
  const webhookUrl = `${settings.appBaseUrl.replace(/\/$/, "")}/telegram/webhook`;
  await new TelegramClient(settings.telegramBotToken).setWebhook(webhookUrl, settings.telegramWebhookSecret || undefined);
  return redirectWithMessage(request, next, "message", `Webhook installed: ${webhookUrl}`);
}

export async function GET() {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const settings = await getSettings();
  if (!settings.telegramBotToken) {
    return NextResponse.json({ error: "Missing Telegram bot token" }, { status: 400 });
  }
  const webhookUrl = `${settings.appBaseUrl.replace(/\/$/, "")}/telegram/webhook`;
  return NextResponse.json(await new TelegramClient(settings.telegramBotToken).setWebhook(webhookUrl, settings.telegramWebhookSecret || undefined));
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
