import { NextRequest, NextResponse } from "next/server";
import { consumeRestartAvailability, selfUpdateGuard } from "@/lib/self-update";

export async function POST(request: NextRequest) {
  const guard = selfUpdateGuard(request.headers);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  if (!consumeRestartAvailability()) {
    return NextResponse.json(
      { error: "Restart is not available until self-update completes successfully." },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    restartRequested: true,
    message: "Restart requested. Restart supervision is handled outside Taskix."
  });
}
