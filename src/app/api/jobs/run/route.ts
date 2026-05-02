import { NextResponse } from "next/server";
import { runNextJob } from "@/lib/job-runner";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST() {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  return NextResponse.json(await runNextJob());
}
