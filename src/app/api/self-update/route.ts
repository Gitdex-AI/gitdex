import { NextRequest, NextResponse } from "next/server";
import { buildSelfUpdateState, mintSelfUpdateOperatorIntent } from "@/lib/self-update";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function GET(request: NextRequest) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const operatorIntent = mintSelfUpdateOperatorIntent();
  const response = NextResponse.json(buildSelfUpdateState(request, operatorIntent));

  if (operatorIntent) {
    response.cookies.set(operatorIntent.cookie.name, operatorIntent.cookie.value, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: operatorIntent.cookie.maxAge
    });
  }

  return response;
}
