import { NextRequest, NextResponse } from "next/server";
import { runSelfUpdate, selfUpdateGuard } from "@/lib/self-update";

export async function POST(request: NextRequest) {
  const guard = selfUpdateGuard(request.headers);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const result = await runSelfUpdate();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
