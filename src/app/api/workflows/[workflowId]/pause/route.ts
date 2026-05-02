import { NextResponse } from "next/server";
import { setWorkflowPaused } from "@/lib/store";
import { requireConsoleApiAuth } from "@/lib/console-auth";

export async function POST(request: Request, { params }: { params: Promise<{ workflowId: string }> }) {
  const unauthorized = await requireConsoleApiAuth();
  if (unauthorized) return unauthorized;
  const { workflowId } = await params;
  const body = (await request.json().catch(() => ({}))) as { paused?: boolean };
  const workflow = await setWorkflowPaused(workflowId, Boolean(body.paused));
  if (!workflow) return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
  return NextResponse.json(workflow);
}
