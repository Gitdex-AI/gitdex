import { NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { getSettings } from "@/lib/settings";
import { cleanupInactiveWorktrees } from "@/lib/worktree-manager";

export async function POST(request: Request) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const settings = await getSettings();
  const result = await cleanupInactiveWorktrees(settings.worktreeRetentionDays);
  const message = encodeURIComponent(`Cleaned ${result.removed.length} inactive worktree(s).`);
  return NextResponse.redirect(new URL(`/settings?message=${message}`, request.url), { status: 303 });
}
