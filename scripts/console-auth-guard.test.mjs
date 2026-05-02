import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
    assert.equal(authorizeConsolePageRequest({ authenticated: false }), "login");
    assert.equal(authorizeConsolePageRequest({ authenticated: true }), "allow");
  });

  it("allows uninitialized and authenticated API requests but rejects initialized anonymous access", () => {
    assert.equal(authorizeConsoleApiRequest({ initialized: false, authenticated: false }), null);
    assert.equal(authorizeConsoleApiRequest({ initialized: true, authenticated: true }), null);

    const response = authorizeConsoleApiRequest({ initialized: true, authenticated: false });
    assert.equal(response?.status, 401);
  });
});
