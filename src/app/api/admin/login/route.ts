import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/admin-auth";
import { createAdminSession, setAdminSessionCookie } from "@/lib/session-auth";

export async function POST(request: Request) {
  const body = await readRequestBody(request);
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const result = await authenticateAdmin(username, password);

  if (!result.ok && result.reason === "not_initialized") {
    return NextResponse.json({ ok: false, error: "Admin setup has not been completed." }, { status: 409 });
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Invalid username or password." }, { status: 401 });
  }

  const token = await createAdminSession();
  await setAdminSessionCookie(token);
  return NextResponse.json({ ok: true, username: result.username });
}

async function readRequestBody(request: Request): Promise<Record<string, FormDataEntryValue | unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await request.json() as Record<string, unknown>;
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}
