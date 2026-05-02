import { NextResponse } from "next/server";
import { checkCodexStatus, getCachedCodexStatus, saveCodexStatus } from "@/lib/codex-status";
import { getSettings } from "@/lib/settings";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function GET() {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  return NextResponse.json({ status: getCachedCodexStatus() });
}

export async function POST() {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const settings = await getSettings();
  const status = await checkCodexStatus(settings);
  saveCodexStatus(status);
  return NextResponse.json({ status });
}
