import { NextResponse } from "next/server";
import { ensureGitHubSshKey } from "@/lib/github-local";
import { getSettings, saveSettings } from "@/lib/settings";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: Request) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const form = await request.formData();
  const owner = String(form.get("githubUsername") ?? "").trim();
  if (!owner) {
    return NextResponse.redirect(new URL("/settings?error=GitHub%20owner%20is%20required.", request.url), { status: 303 });
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
  return NextResponse.redirect(new URL(`/settings?message=${encodeURIComponent(message)}`, request.url), { status: 303 });
}
