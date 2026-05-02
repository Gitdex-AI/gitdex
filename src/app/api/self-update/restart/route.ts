import { NextRequest, NextResponse } from "next/server";
import {
  consumeRestartAvailability,
  markSelfUpdateRestartFailed,
  markSelfUpdateRestartRequested,
  selfUpdateGuard
} from "@/lib/self-update";
import { requestTaskixServiceRestart } from "@/lib/taskix-service";

export async function POST(request: NextRequest) {
  const result = await requestTaskixServiceRestart({
    source: request,
    guard: selfUpdateGuard,
    consumeRestartAvailability
  });
  if (!result.ok) {
    markSelfUpdateRestartFailed(result.error ?? "Taskix service restart failed.");
    return NextResponse.json(
      {
        ok: false,
        restartRequested: false,
        error: result.error,
        manager: result.manager,
        serviceName: result.serviceName,
        stdout: result.stdout,
        stderr: result.stderr
      },
      { status: result.status }
    );
  }

  markSelfUpdateRestartRequested();
  return NextResponse.json({
    ok: true,
    restartRequested: true,
    manager: result.manager,
    serviceName: result.serviceName,
    stdout: result.stdout,
    stderr: result.stderr
  }, { status: result.status });
}
