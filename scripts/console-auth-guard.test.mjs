import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { middleware } = await import("../middleware.ts");
const {
  adminSessionCookieName,
  authorizeConsoleApiRequest,
  authorizeConsolePageRequest,
  hasAdminSessionCookie,
  isConsoleApiPath,
  isConsolePagePath,
  isPublicConsoleApiPath,
  isPublicConsolePagePath
} = await import("../src/lib/console-auth.ts");

describe("console auth guard", () => {
  it("keeps first-run admin setup and login/session APIs public", () => {
    assert.equal(isPublicConsoleApiPath("/api/admin/setup"), true);
    assert.equal(isPublicConsoleApiPath("/api/admin/login"), true);
    assert.equal(isPublicConsoleApiPath("/api/admin/session"), true);
    assert.equal(isPublicConsoleApiPath("/api/admin/logout"), true);
    assert.equal(isPublicConsolePagePath("/setup"), true);
    assert.equal(isPublicConsolePagePath("/login"), true);
  });

  it("classifies console pages and internal APIs for protection", () => {
    assert.equal(isConsoleApiPath("/api/projects"), true);
    assert.equal(isPublicConsoleApiPath("/api/projects"), false);
    assert.equal(isConsoleApiPath("/telegram/webhook"), false);
    assert.equal(isConsolePagePath("/projects"), true);
    assert.equal(isConsolePagePath("/settings"), true);
    assert.equal(isConsolePagePath("/_next/static/chunk.js"), false);
    assert.equal(isConsolePagePath("/favicon.ico"), false);
  });

  it("recognizes the admin session cookie without treating it as verified page auth", () => {
    assert.equal(hasAdminSessionCookie(new Set()), false);
    assert.equal(hasAdminSessionCookie(new Set([adminSessionCookieName])), true);
    assert.equal(authorizeConsolePageRequest({ initialized: false, authenticated: false }), "setup");
    assert.equal(authorizeConsolePageRequest({ initialized: true, authenticated: false }), "login");
    assert.equal(authorizeConsolePageRequest({ initialized: true, authenticated: true }), "allow");
    assert.equal(authorizeConsolePageRequest({ initialized: false, authenticated: true }), "allow");
  });

  it("allows uninitialized and authenticated API requests but rejects initialized anonymous access", () => {
    assert.equal(authorizeConsoleApiRequest({ initialized: false, authenticated: false }), null);
    assert.equal(authorizeConsoleApiRequest({ initialized: true, authenticated: true }), null);

    const response = authorizeConsoleApiRequest({ initialized: true, authenticated: false });
    assert.equal(response?.status, 401);
  });

  it("allows setup and login pages to render without probing auth APIs", async () => {
    await withMockedMiddlewareFetch({ initialized: true, authenticated: false }, async ({ calls }) => {
      const setupResponse = await middleware(createMiddlewareRequest("/setup"));
      const loginResponse = await middleware(createMiddlewareRequest("/login"));

      assert.equal(setupResponse.headers.get("x-middleware-next"), "1");
      assert.equal(loginResponse.headers.get("x-middleware-next"), "1");
      assert.deepEqual(calls, []);
    });
  });

  it("redirects anonymous protected pages to setup before initialization", async () => {
    await withMockedMiddlewareFetch({ initialized: false, authenticated: false }, async ({ calls }) => {
      const response = await middleware(createMiddlewareRequest("/projects"));

      assert.equal(response.status, 307);
      assert.equal(new URL(response.headers.get("location")).pathname, "/setup");
      assert.deepEqual(calls.map((call) => call.pathname), ["/api/admin/setup"]);
    });
  });

  it("redirects anonymous protected pages to login after initialization", async () => {
    await withMockedMiddlewareFetch({ initialized: true, authenticated: false }, async ({ calls }) => {
      const response = await middleware(createMiddlewareRequest("/projects?filter=active"));
      const location = new URL(response.headers.get("location"));

      assert.equal(response.status, 307);
      assert.equal(location.pathname, "/login");
      assert.equal(location.searchParams.get("next"), "/projects?filter=active");
      assert.deepEqual(calls.map((call) => call.pathname), ["/api/admin/setup"]);
    });
  });

  it("allows authenticated protected pages after verifying the admin session", async () => {
    await withMockedMiddlewareFetch({ initialized: true, authenticated: true }, async ({ calls }) => {
      const response = await middleware(createMiddlewareRequest("/projects", `${adminSessionCookieName}=session-token`));

      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.deepEqual(calls.map((call) => call.pathname), ["/api/admin/session"]);
    });
  });

  it("returns 401 for initialized anonymous protected APIs", async () => {
    await withMockedMiddlewareFetch({ initialized: true, authenticated: false }, async ({ calls }) => {
      const response = await middleware(createMiddlewareRequest("/api/projects"));
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.deepEqual(body, { ok: false, error: "Authentication required." });
      assert.deepEqual(calls.map((call) => call.pathname), ["/api/admin/setup"]);
    });
  });
});

function createMiddlewareRequest(path, cookie = "") {
  const nextUrl = new URL(path, "http://127.0.0.1:8000");
  nextUrl.clone = () => new URL(nextUrl.toString());

  return {
    nextUrl,
    cookies: {
      has: (name) => cookie.split(";").some((part) => part.trim().startsWith(`${name}=`))
    },
    headers: {
      get: (name) => name.toLowerCase() === "cookie" ? cookie : null
    }
  };
}

async function withMockedMiddlewareFetch({ initialized, authenticated }, fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ pathname: url.pathname, cookie: init?.headers?.cookie ?? "" });

    if (url.pathname === "/api/admin/setup") {
      return Response.json({ initialized });
    }
    if (url.pathname === "/api/admin/session") {
      return new Response(null, { status: authenticated ? 200 : 401 });
    }
    return new Response(null, { status: 404 });
  };

  try {
    await fn({ calls });
  } finally {
    globalThis.fetch = originalFetch;
  }
}
