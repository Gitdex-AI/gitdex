import { NextRequest, NextResponse } from "next/server";
import { getSelfUpdateState } from "@/lib/self-update";

export async function GET(request: NextRequest) {
  return NextResponse.json(getSelfUpdateState(request));
}
