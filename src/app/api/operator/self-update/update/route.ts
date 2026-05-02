import { NextRequest, NextResponse } from "next/server";
import {
  runOperatorSelfUpdate,
  selfUpdateOperatorNonceCookieName
} from "@/lib/self-update";

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

  const response = await runOperatorSelfUpdate({
    nonce: request.cookies.get(selfUpdateOperatorNonceCookieName)?.value,
    token: payload.operatorIntentToken
  });

  if (!response.ok || !response.result) {
    return NextResponse.json({ error: response.error }, { status: response.status });
  }

  return NextResponse.json(response.result, { status: response.status });
}
