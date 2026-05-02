import { NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { runConfirmedSelfUpdate, type SelfUpdateConfirmationInput } from "@/lib/self-update";

export async function POST(request: Request) {
  const unauthorized = await requireConsoleApiAuth("/api/admin/self-update/update");
  if (unauthorized) return unauthorized;

  const payload = await readConfirmationPayload(request);
  const response = await runConfirmedSelfUpdate(payload);
  if (!response.ok || !response.result) {
    return NextResponse.json({ ok: false, error: response.error, result: response.result }, { status: response.status });
  }

  return NextResponse.json(response.result, { status: response.status });
}

async function readConfirmationPayload(request: Request): Promise<SelfUpdateConfirmationInput> {
  try {
    return (await request.json()) as SelfUpdateConfirmationInput;
  } catch {
    return {};
  }
}
