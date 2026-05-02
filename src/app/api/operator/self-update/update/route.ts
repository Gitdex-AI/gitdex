import { NextRequest, NextResponse } from "next/server";
import {
  runOperatorSelfUpdateAndRestart,
  selfUpdateOperatorNonceCookieName
} from "@/lib/self-update";
import { restartTaskixService } from "@/lib/taskix-service";

type OperatorUpdatePayload = {
  operatorIntentToken?: string;
};

export async function POST(request: NextRequest) {
  let payload: OperatorUpdatePayload = {};

  try {
    payload = (await request.json()) as OperatorUpdatePayload;
  } catch {
    payload = {};
  }

  const response = await runOperatorSelfUpdateAndRestart({
    nonce: request.cookies.get(selfUpdateOperatorNonceCookieName)?.value,
    token: payload.operatorIntentToken
  }, restartTaskixService);

  if (!response.ok || !response.update) {
    return NextResponse.json({ error: response.error, restart: response.restart }, { status: response.status });
  }

  return NextResponse.json(response.update, { status: response.status });
}
