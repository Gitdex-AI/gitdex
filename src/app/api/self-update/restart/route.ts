import { NextRequest, NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import {
  requestConfirmedSelfUpdateRestart,
  selfUpdateGuard,
  type SelfUpdateConfirmationInput
} from "@/lib/self-update";
import { restartGitdexService } from "@/lib/service-management";

export async function POST(request: NextRequest) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const guard = selfUpdateGuard(request);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const response = await requestConfirmedSelfUpdateRestart(await readConfirmationPayload(request), restartGitdexService);
  if (!response.ok || !response.restart) {
    return NextResponse.json({ ok: false, error: response.error, restart: response.restart }, { status: response.status });
  }

  return NextResponse.json(response.restart, { status: response.status });
}

async function readConfirmationPayload(request: Request): Promise<SelfUpdateConfirmationInput> {
  try {
    return (await request.json()) as SelfUpdateConfirmationInput;
  } catch {
    return {};
  }
}
