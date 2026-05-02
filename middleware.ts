import { NextRequest, NextResponse } from "next/server";

const adminSessionCookieName = "taskix_admin_session";
const publicConsoleApiPaths = new Set([
  "/api/admin/login",
  "/api/admin/logout",
  "/api/admin/session",
  "/api/admin/setup"
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicConsoleApiPath(pathname)) {
    return NextResponse.next();
  }
  if (pathname === "/login") return renderLoginPage(request);
  if (pathname === "/setup") return renderSetupPage();

  if (isConsoleApiPath(pathname) && !hasAdminSessionCookie(request.cookies)) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }

  if (isConsolePagePath(pathname)) {
    if (!hasAdminSessionCookie(request.cookies)) {
      return redirectToLogin(request);
    }
    const pageAuth = authorizeConsolePageRequest({ authenticated: await hasVerifiedAdminSession(request) });
    if (pageAuth === "login") {
      return redirectToLogin(request);
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

function authorizeConsolePageRequest({ authenticated }: { authenticated: boolean }): "allow" | "login" {
  return authenticated ? "allow" : "login";
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

function renderLoginPage(request: NextRequest): NextResponse {
  const nextPath = request.nextUrl.searchParams.get("next") || "/";
  return html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Taskix Login</title>
    <style>${authPageStyles}</style>
  </head>
  <body>
    <main>
      <h1>Taskix Console</h1>
      <form id="login-form">
        <label>Username<input name="username" value="admin" autocomplete="username" /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" autofocus /></label>
        <p id="message" role="alert"></p>
        <button type="submit">Log in</button>
      </form>
      <a href="/setup">First-run setup</a>
    </main>
    <script>
      const form = document.getElementById("login-form");
      const message = document.getElementById("message");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        message.textContent = "";
        const response = await fetch("/api/admin/login", { method: "POST", body: new FormData(form) });
        if (response.ok) {
          window.location.assign(${JSON.stringify(nextPath)});
          return;
        }
        const body = await response.json().catch(() => ({}));
        message.textContent = body.error || "Login failed.";
      });
    </script>
  </body>
</html>`);
}

function renderSetupPage(): NextResponse {
  return html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Taskix Setup</title>
    <style>${authPageStyles}</style>
  </head>
  <body>
    <main>
      <h1>Taskix Setup</h1>
      <form id="setup-form">
        <label>Username<input name="username" value="admin" autocomplete="username" /></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" autofocus /></label>
        <p id="message" role="alert"></p>
        <button type="submit">Create admin</button>
      </form>
      <a href="/login">Log in</a>
    </main>
    <script>
      const form = document.getElementById("setup-form");
      const message = document.getElementById("message");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        message.textContent = "";
        const response = await fetch("/api/admin/setup", { method: "POST", body: new FormData(form) });
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
          message.textContent = "Admin created. Redirecting to login.";
          window.location.assign("/login");
          return;
        }
        message.textContent = body.error || "Setup failed.";
      });
    </script>
  </body>
</html>`);
}

function html(body: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

const authPageStyles = `
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fb; color: #151922; }
  main { width: min(100% - 32px, 360px); padding: 28px; border: 1px solid #d9dee8; border-radius: 8px; background: #fff; box-shadow: 0 12px 36px rgb(21 25 34 / 8%); }
  h1 { margin: 0 0 20px; font-size: 24px; line-height: 1.2; }
  form { display: grid; gap: 14px; }
  label { display: grid; gap: 6px; font-size: 13px; font-weight: 700; }
  input { height: 40px; border: 1px solid #c8cfdd; border-radius: 6px; padding: 0 10px; font: inherit; }
  button { height: 42px; border: 0; border-radius: 6px; background: #1f2937; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
  p { min-height: 20px; margin: 0; color: #b42318; font-size: 13px; }
  a { display: inline-block; margin-top: 16px; color: #1d4ed8; font-size: 13px; font-weight: 700; }
`;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)"
  ]
};
