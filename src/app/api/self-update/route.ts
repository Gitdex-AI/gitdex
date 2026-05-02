import { NextRequest, NextResponse } from "next/server";
import { buildSelfUpdateState, mintSelfUpdateOperatorIntent } from "@/lib/self-update";

export async function GET(request: NextRequest) {
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
