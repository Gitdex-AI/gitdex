import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AdminSessionRecord } from "@/lib/store";

export const adminSessionCookieName = "taskix_admin_session";

const sessionTokenBytes = 32;
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;

export type AdminSessionVerification =
  | { authenticated: true; username: "admin" }
  | { authenticated: false };

export type AdminSessionStore = {
  getAdminSession(): Promise<AdminSessionRecord | null>;
  saveAdminSession(session: AdminSessionRecord): Promise<void>;
  deleteAdminSession(): Promise<void>;
};

export async function createAdminSession(): Promise<string> {
  const store = await getAdminSessionStore();
  return createAdminSessionWithStore(store);
}

export async function createAdminSessionWithStore(store: Pick<AdminSessionStore, "saveAdminSession">): Promise<string> {
  const token = randomBytes(sessionTokenBytes).toString("base64url");
  const now = Date.now();
  await store.saveAdminSession({
    username: "admin",
    tokenHash: hashSessionToken(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + sessionDurationMs).toISOString()
  });
  return token;
}

export async function verifyAdminSessionToken(token: string | null | undefined): Promise<AdminSessionVerification> {
  const store = await getAdminSessionStore();
  return verifyAdminSessionTokenWithStore(token, store);
}

export async function verifyAdminSessionTokenWithStore(token: string | null | undefined, store: Pick<AdminSessionStore, "getAdminSession" | "deleteAdminSession">): Promise<AdminSessionVerification> {
  if (!token) return { authenticated: false };

  const session = await store.getAdminSession();
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    if (session) await store.deleteAdminSession();
    return { authenticated: false };
  }

  const expected = Buffer.from(session.tokenHash, "hex");
  const actual = Buffer.from(hashSessionToken(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { authenticated: false };
  }

  return { authenticated: true, username: session.username };
}

export async function getAdminSessionFromCookies(): Promise<AdminSessionVerification> {
  const cookieStore = await getCookieStore();
  return verifyAdminSessionToken(cookieStore.get(adminSessionCookieName)?.value);
}

export async function setAdminSessionCookie(token: string): Promise<void> {
  const cookieStore = await getCookieStore();
  cookieStore.set(adminSessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(sessionDurationMs / 1000)
  });
}

export async function clearAdminSession(): Promise<void> {
  const store = await getAdminSessionStore();
  await store.deleteAdminSession();
  const cookieStore = await getCookieStore();
  cookieStore.set(adminSessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function getAdminSessionStore(): Promise<AdminSessionStore> {
  const store = await import("@/lib/store");
  return {
    getAdminSession: store.getAdminSession,
    saveAdminSession: store.saveAdminSession,
    deleteAdminSession: store.deleteAdminSession
  };
}

async function getCookieStore() {
  const headers = await import("next/headers");
  return headers.cookies();
}
