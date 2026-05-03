import { NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import {
  requestConfirmedSelfUpdateRestart,
  type SelfUpdateConfirmationInput
} from "@/lib/self-update";
import { restartGitdexService } from "@/lib/gitdex-service";

export async function POST(request: Request) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;

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
