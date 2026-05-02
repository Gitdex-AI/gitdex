import { NextRequest, NextResponse } from "next/server";
import { getSelfUpdateState, isLocalhostRequest } from "@/lib/self-update";

export async function GET(request: NextRequest) {
  if (!isLocalhostRequest(request.headers)) {
    return NextResponse.json(
      { error: "Self-update endpoints only accept localhost requests." },
      { status: 403 }
    );
  }

  return NextResponse.json(getSelfUpdateState());
}
