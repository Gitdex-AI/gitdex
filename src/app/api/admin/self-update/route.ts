import { NextRequest, NextResponse } from "next/server";
import { requireConsoleApiAuth } from "@/lib/console-auth";
import { getSelfUpdateState } from "@/lib/self-update";

export async function GET(request: NextRequest) {
  const unauthorized = await requireConsoleApiAuth(request.nextUrl.pathname);
  if (unauthorized) return unauthorized;

  return NextResponse.json(getSelfUpdateState(request));
}
