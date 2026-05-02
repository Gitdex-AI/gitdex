import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
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
  return NextResponse.redirect(new URL("/settings?message=Settings%20saved.", request.url), { status: 303 });
}
