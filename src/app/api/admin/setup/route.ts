import { NextResponse } from "next/server";
import { isAdminInitialized, setupInitialAdmin } from "@/lib/admin-auth";

export async function GET() {
  const initialized = await isAdminInitialized();
  return NextResponse.json({ initialized, setupAvailable: !initialized });
}

export async function POST(request: Request) {
  const body = await readRequestBody(request);
  const username = String(body.username ?? "admin").trim();
  const password = String(body.password ?? "");

  if (username !== "admin") {
    return NextResponse.json({ ok: false, error: "Setup only supports the fixed admin account." }, { status: 400 });
  }

  const result = await setupInitialAdmin(password);
  if (!result.ok && result.reason === "already_initialized") {
    return NextResponse.json({ ok: false, error: "Admin setup has already been completed." }, { status: 409 });
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Password is required." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, username: result.username }, { status: 201 });
}

async function readRequestBody(request: Request): Promise<Record<string, FormDataEntryValue | unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await request.json() as Record<string, unknown>;
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}
