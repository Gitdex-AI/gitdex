import { NextResponse } from "next/server";
import { ensureGitHubSshKey } from "@/lib/github-local";
import { getSettings, saveSettings } from "@/lib/settings";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: Request) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const form = await request.formData();
  const next = safeNextPath(form.get("next"), "/");
  const owner = String(form.get("githubUsername") ?? "").trim();
  if (!owner) {
    return redirectWithMessage(request, next, "error", "GitHub owner is required.");
  }

  const settings = await getSettings();
  const key = await ensureGitHubSshKey(owner);
  await saveSettings({
    ...settings,
    githubUsername: owner,
    githubSshPrivateKeyPath: key.privateKeyPath,
    githubSshPublicKey: key.publicKey
  });

  const message = key.created
    ? "GitHub owner saved. SSH key generated. Add the public key to the GitHub user or organization."
    : "GitHub owner saved. Existing SSH key reused.";
  return redirectWithMessage(request, next, "message", message);
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
