import { NextResponse } from "next/server";
import { checkGhStatus, getCachedGhStatus, saveGhStatus } from "@/lib/gh-status";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function GET() {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  return NextResponse.json({ status: getCachedGhStatus() });
}

export async function POST() {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const status = await checkGhStatus();
  saveGhStatus(status);
  return NextResponse.json({ status });
}
