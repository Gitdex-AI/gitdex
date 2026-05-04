import { NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { getSettings } from "@/lib/settings";
import { cleanupInactiveWorktrees } from "@/lib/worktree-manager";

export async function POST(request: Request) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const form = await request.formData().catch(() => null);
  const next = safeNextPath(form?.get("next") ?? null, "/");
  const settings = await getSettings();
  const result = await cleanupInactiveWorktrees(settings.worktreeRetentionDays);
  const redirectTo = new URL(next, request.url);
  redirectTo.searchParams.set("message", `Cleaned ${result.removed.length} inactive worktree(s).`);
  return NextResponse.redirect(redirectTo, { status: 303 });
}

function safeNextPath(value: FormDataEntryValue | null, fallback: string): string {
  const next = String(value ?? "").trim();
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
