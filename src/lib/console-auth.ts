export const adminSessionCookieName = "taskix_admin_session";

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

export function isConsoleApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isPublicConsoleApiPath(pathname: string): boolean {
  return publicConsoleApiPaths.has(normalizePath(pathname));
}

export function isPublicConsolePagePath(pathname: string): boolean {
  return publicConsolePagePaths.has(normalizePath(pathname));
}

export function isConsolePagePath(pathname: string): boolean {
  const normalized = normalizePath(pathname);
  if (isConsoleApiPath(normalized)) return false;
  if (isPublicAssetPath(normalized)) return false;
  if (normalized === "/telegram/webhook") return false;
  return true;
}

export function hasAdminSessionCookie(cookies: { has(name: string): boolean }): boolean {
  return cookies.has(adminSessionCookieName);
}

export function authorizeConsoleApiRequest({ initialized, authenticated }: { initialized: boolean; authenticated: boolean }): Response | null {
  if (!initialized || authenticated) return null;
  return Response.json({ ok: false, error: "Authentication required." }, { status: 401 });
}

export function authorizeConsolePageRequest({ initialized, authenticated }: { initialized: boolean; authenticated: boolean }): "allow" | "setup" | "login" {
  if (authenticated) return "allow";
  return initialized ? "login" : "setup";
}

export async function requireConsoleApiAuth(pathname = ""): Promise<Response | null> {
  if (pathname && isPublicConsoleApiPath(pathname)) return null;
  const { isAdminInitialized } = await import("@/lib/admin-auth");
  if (!(await isAdminInitialized())) return null;

  const { getAdminSessionFromCookies } = await import("@/lib/session-auth");
  const session = await getAdminSessionFromCookies();
  return authorizeConsoleApiRequest({ initialized: true, authenticated: session.authenticated });
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
