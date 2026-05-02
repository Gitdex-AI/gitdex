import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";
import { describe, it } from "node:test";

process.chdir(mkdtempSync(`${tmpdir()}/taskix-admin-auth-`));

const { setupInitialAdminWithStore, authenticateAdminWithStore } = await import("../src/lib/admin-auth.ts");
const { createAdminSessionWithStore, verifyAdminSessionTokenWithStore } = await import("../src/lib/session-auth.ts");

describe("admin auth", () => {
  it("allows one first-run setup for the fixed admin account and stores only a hash", async () => {
    const store = createStore();
    const setup = await setupInitialAdminWithStore("correct horse battery staple", store);

    assert.deepEqual(setup, { ok: true, username: "admin" });
    const account = await store.getAdminAccount();
    assert.equal(account?.username, "admin");
    assert.match(account?.passwordHash ?? "", /^scrypt:/);
    assert.doesNotMatch(JSON.stringify(account), /correct horse battery staple/);
  });

  it("rejects setup after initialization without replacing the account hash", async () => {
    const store = createStore();
    await setupInitialAdminWithStore("correct horse battery staple", store);
    const before = await store.getAdminAccount();
    const setup = await setupInitialAdminWithStore("replacement-password", store);
    const emptySetup = await setupInitialAdminWithStore("", store);
    const after = await store.getAdminAccount();

    assert.deepEqual(setup, { ok: false, reason: "already_initialized" });
    assert.deepEqual(emptySetup, { ok: false, reason: "already_initialized" });
    assert.equal(after?.passwordHash, before?.passwordHash);
  });

  it("authenticates initialized admin and rejects bad credentials", async () => {
    const store = createStore();
    await setupInitialAdminWithStore("correct horse battery staple", store);

    assert.deepEqual(await authenticateAdminWithStore("admin", "correct horse battery staple", store), { ok: true, username: "admin" });
    assert.deepEqual(await authenticateAdminWithStore("admin", "wrong", store), { ok: false, reason: "invalid_credentials" });
    assert.deepEqual(await authenticateAdminWithStore("not-admin", "correct horse battery staple", store), { ok: false, reason: "invalid_credentials" });
  });

  it("creates a server-verifiable admin session and clears it from storage", async () => {
    const store = createStore();
    const token = await createAdminSessionWithStore(store);

    assert.deepEqual(await verifyAdminSessionTokenWithStore(token, store), { authenticated: true, username: "admin" });
    assert.deepEqual(await verifyAdminSessionTokenWithStore("invalid", store), { authenticated: false });

    await store.deleteAdminSession();
    assert.deepEqual(await verifyAdminSessionTokenWithStore(token, store), { authenticated: false });
  });
});

function createStore() {
  return {
    account: null,
    session: null,
    async getAdminAccount() {
      return this.account;
    },
    async saveInitialAdminAccount(account) {
      if (this.account) return false;
      this.account = account;
      return true;
    },
    async getAdminSession() {
      return this.session;
    },
    async saveAdminSession(session) {
      this.session = session;
    },
    async deleteAdminSession() {
      this.session = null;
    }
  };
}
