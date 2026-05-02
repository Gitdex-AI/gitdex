import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { TelegramClient } from "@/lib/telegram";
import type { Settings } from "@/lib/types";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: Request) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const form = await request.formData();
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
    githubSshPublicKey: current.githubSshPublicKey
  };
  await saveSettings(settings);

  if (!settings.telegramBotToken) {
    return NextResponse.redirect(new URL("/settings?error=Missing%20Telegram%20bot%20token.", request.url), { status: 303 });
  }
  const webhookUrl = `${settings.appBaseUrl.replace(/\/$/, "")}/telegram/webhook`;
  await new TelegramClient(settings.telegramBotToken).setWebhook(webhookUrl, settings.telegramWebhookSecret || undefined);
  return NextResponse.redirect(new URL(`/settings?message=${encodeURIComponent(`Webhook installed: ${webhookUrl}`)}`, request.url), { status: 303 });
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
