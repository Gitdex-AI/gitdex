import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { AdminAccountRecord } from "@/lib/store";

const scrypt = promisify(scryptCallback);
const adminUsername = "admin";
const passwordSaltBytes = 16;
const passwordKeyBytes = 64;

export type AdminSetupResult =
  | { ok: true; username: "admin" }
  | { ok: false; reason: "already_initialized" | "invalid_password" };

export type AdminLoginResult =
  | { ok: true; username: "admin" }
  | { ok: false; reason: "not_initialized" | "invalid_credentials" };

export type AdminAccountStore = {
  getAdminAccount(): Promise<AdminAccountRecord | null>;
  saveInitialAdminAccount(account: AdminAccountRecord): Promise<boolean>;
};

export async function isAdminInitialized(): Promise<boolean> {
  const store = await getAdminAccountStore();
  return isAdminInitializedWithStore(store);
}

export async function setupInitialAdmin(password: string): Promise<AdminSetupResult> {
  const store = await getAdminAccountStore();
  return setupInitialAdminWithStore(password, store);
}

export async function authenticateAdmin(username: string, password: string): Promise<AdminLoginResult> {
  const store = await getAdminAccountStore();
  return authenticateAdminWithStore(username, password, store);
}

export async function isAdminInitializedWithStore(store: Pick<AdminAccountStore, "getAdminAccount">): Promise<boolean> {
  return (await store.getAdminAccount()) !== null;
}

export async function setupInitialAdminWithStore(password: string, store: AdminAccountStore): Promise<AdminSetupResult> {
  if (await store.getAdminAccount()) return { ok: false, reason: "already_initialized" };
  if (!password.trim()) return { ok: false, reason: "invalid_password" };

  const passwordHash = await hashPassword(password);
  const saved = await store.saveInitialAdminAccount({
    username: adminUsername,
    passwordHash,
    initializedAt: new Date().toISOString()
  });

  return saved ? { ok: true, username: adminUsername } : { ok: false, reason: "already_initialized" };
}

export async function authenticateAdminWithStore(username: string, password: string, store: Pick<AdminAccountStore, "getAdminAccount">): Promise<AdminLoginResult> {
  const account = await store.getAdminAccount();
  if (!account) return { ok: false, reason: "not_initialized" };
  if (username !== adminUsername) return { ok: false, reason: "invalid_credentials" };
  const passwordMatches = await verifyPassword(password, account.passwordHash);
  return passwordMatches ? { ok: true, username: adminUsername } : { ok: false, reason: "invalid_credentials" };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(passwordSaltBytes);
  const derivedKey = await scrypt(password, salt, passwordKeyBytes) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derivedKey.toString("base64")}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;

  const expectedKey = Buffer.from(hashValue, "base64");
  const actualKey = await scrypt(password, Buffer.from(saltValue, "base64"), expectedKey.length) as Buffer;
  return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey);
}

async function getAdminAccountStore(): Promise<AdminAccountStore> {
  const store = await import("@/lib/store");
  return {
    getAdminAccount: store.getAdminAccount,
    saveInitialAdminAccount: store.saveInitialAdminAccount
  };
}
