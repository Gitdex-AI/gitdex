import { NextRequest, NextResponse } from "next/server.js";

const adminSessionCookieName = "gitdex_admin_session";
const publicConsoleApiPaths = new Set([
  "/api/admin/login",
  "/api/admin/logout",
  "/api/admin/session",
  "/api/admin/setup"
]);
const publicConsolePagePaths = new Set([
  "/login",
  "/setup"
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicConsoleApiPath(pathname) || isPublicConsolePagePath(pathname)) {
    return NextResponse.next();
  }

  if (isConsoleApiPath(pathname)) {
    const initialized = await getAdminInitialized(request);
    const authenticated = hasAdminSessionCookie(request.cookies)
      ? await hasVerifiedAdminSession(request)
      : false;
    const apiAuth = authorizeConsoleApiRequest({ initialized, authenticated });
    if (apiAuth) return apiAuth;
  }

  if (isConsolePagePath(pathname)) {
    const authenticated = hasAdminSessionCookie(request.cookies)
      ? await hasVerifiedAdminSession(request)
      : false;
    const initialized = authenticated ? true : await getAdminInitialized(request);
    const pageAuth = authorizeConsolePageRequest({ initialized, authenticated });
    if (pageAuth === "login") {
      return redirectToLogin(request);
    }
    if (pageAuth === "setup") {
      return redirectToSetup(request);
    }
  }

  return NextResponse.next();
}

function isConsoleApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isPublicConsoleApiPath(pathname: string): boolean {
  return publicConsoleApiPaths.has(normalizePath(pathname));
}

function isPublicConsolePagePath(pathname: string): boolean {
  return publicConsolePagePaths.has(normalizePath(pathname));
}

function isConsolePagePath(pathname: string): boolean {
  const normalized = normalizePath(pathname);
  if (isConsoleApiPath(normalized)) return false;
  if (isPublicAssetPath(normalized)) return false;
  if (normalized === "/telegram/webhook") return false;
  return true;
}

function hasAdminSessionCookie(cookies: { has(name: string): boolean }): boolean {
  return cookies.has(adminSessionCookieName);
}

function authorizeConsoleApiRequest({ initialized, authenticated }: { initialized: boolean; authenticated: boolean }): Response | null {
  if (!initialized || authenticated) return null;
  return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
}

function authorizeConsolePageRequest({ initialized, authenticated }: { initialized: boolean; authenticated: boolean }): "allow" | "setup" | "login" {
  if (authenticated) return "allow";
  return initialized ? "login" : "setup";
}

async function hasVerifiedAdminSession(request: NextRequest): Promise<boolean> {
  const sessionUrl = request.nextUrl.clone();
  sessionUrl.pathname = "/api/admin/session";
  sessionUrl.search = "";

  const response = await fetch(sessionUrl, {
    cache: "no-store",
    headers: {
      cookie: request.headers.get("cookie") ?? ""
    }
  }).catch(() => null);

  return response?.ok === true;
}

async function getAdminInitialized(request: NextRequest): Promise<boolean> {
  const setupUrl = request.nextUrl.clone();
  setupUrl.pathname = "/api/admin/setup";
  setupUrl.search = "";

  const response = await fetch(setupUrl, {
    cache: "no-store",
    headers: {
      cookie: request.headers.get("cookie") ?? ""
    }
  }).catch(() => null);
  if (!response?.ok) return true;

  const body = await response.json().catch(() => null) as { initialized?: unknown } | null;
  return body?.initialized !== false;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function isPublicAssetPath(pathname: string): boolean {
  return pathname.startsWith("/_next/")
    || pathname === "/favicon.ico"
    || pathname === "/robots.txt"
    || pathname === "/sitemap.xml"
    || /\.[a-zA-Z0-9]+$/.test(pathname);
}

function redirectToSetup(request: NextRequest): NextResponse {
  const setupUrl = request.nextUrl.clone();
  setupUrl.pathname = "/setup";
  setupUrl.search = "";
  return NextResponse.redirect(setupUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)"
  ]
};
