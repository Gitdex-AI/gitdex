import { NextRequest, NextResponse } from "next/server";
import { runSelfUpdate, selfUpdateGuard } from "@/lib/self-update";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: NextRequest) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const guard = selfUpdateGuard(request);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const result = await runSelfUpdate();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
