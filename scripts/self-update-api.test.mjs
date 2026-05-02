import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import process from "node:process";

import {
  consumeRestartAvailability,
  getSelfUpdateState,
  isSelfUpdateEnabled,
  isLocalhostRequest,
  resetSelfUpdateStateForTests,
  runSelfUpdate,
  selfUpdateGuard,
  setSelfUpdateCommandRunnerForTests
} from "../src/lib/self-update.ts";

const originalFlag = process.env.TASKIX_ENABLE_SELF_UPDATE;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.TASKIX_ENABLE_SELF_UPDATE;
  } else {
    process.env.TASKIX_ENABLE_SELF_UPDATE = originalFlag;
  }
  resetSelfUpdateStateForTests();
});

test("disabled flag rejects self-update requests", () => {
  delete process.env.TASKIX_ENABLE_SELF_UPDATE;

  const guard = selfUpdateGuard(localHeaders());

  assert.equal(guard.ok, false);
  assert.equal(guard.status, 403);
  assert.match(guard.error, /disabled/);
});

test("enablement flag must be exactly true", () => {
  process.env.TASKIX_ENABLE_SELF_UPDATE = "TRUE";
  assert.equal(isSelfUpdateEnabled(), false);

  process.env.TASKIX_ENABLE_SELF_UPDATE = "true";
  assert.equal(isSelfUpdateEnabled(), true);
});

test("non-localhost callers are rejected even when enabled", () => {
  process.env.TASKIX_ENABLE_SELF_UPDATE = "true";

  const guard = selfUpdateGuard(new Headers({ "x-forwarded-for": "203.0.113.10", host: "example.com" }));

  assert.equal(guard.ok, false);
  assert.equal(guard.status, 403);
  assert.match(guard.error, /localhost/);
});

test("host headers do not prove a localhost caller", () => {
  process.env.TASKIX_ENABLE_SELF_UPDATE = "true";

  assert.equal(isLocalhostRequest(new Headers({ host: "127.0.0.1:8000" })), false);
  assert.equal(isLocalhostRequest(new Headers({ "x-forwarded-host": "127.0.0.1:8000" })), false);
  assert.equal(selfUpdateGuard(new Headers({ host: "127.0.0.1:8000" })).ok, false);
});

test("forwarding headers do not prove a localhost caller", () => {
  process.env.TASKIX_ENABLE_SELF_UPDATE = "true";

  assert.equal(isLocalhostRequest(new Headers({ "x-forwarded-for": "127.0.0.1" })), false);
  assert.equal(isLocalhostRequest(new Headers({ "x-real-ip": "127.0.0.1" })), false);
  assert.equal(selfUpdateGuard(new Headers({ "x-forwarded-for": "127.0.0.1" })).ok, false);
});

test("route-shaped localhost requests are accepted without trusting forwarded caller headers", () => {
  process.env.TASKIX_ENABLE_SELF_UPDATE = "true";

  assert.equal(
    isLocalhostRequest({
      headers: new Headers({ host: "127.0.0.1:8000" }),
      url: "http://127.0.0.1:8000/api/self-update"
    }),
    true
  );
  assert.equal(
    selfUpdateGuard({
      headers: new Headers({ "x-forwarded-for": "127.0.0.1", host: "127.0.0.1:8000" }),
      url: "http://127.0.0.1:8000/api/self-update"
    }).ok,
    false
  );
});

test("localhost detection accepts loopback address forms", () => {
  assert.equal(isLocalhostRequest(localRequest("127.0.0.1")), true);
  assert.equal(isLocalhostRequest(localRequest("::1")), true);
  assert.equal(isLocalhostRequest(localRequest("::ffff:127.0.0.1")), true);
});

test("successful update runs commands in order and enables restart", async () => {
  const calls = [];
  setSelfUpdateCommandRunnerForTests(async (command) => {
    calls.push(command.command);
    return { command: command.command, exitCode: 0, stdout: `${command.command} ok`, stderr: "" };
  });

  const result = await runSelfUpdate("/tmp/taskix-self-update-test");

  assert.deepEqual(calls, ["git pull", "npm install", "npm run build"]);
  assert.equal(result.ok, true);
  assert.equal(result.restartAvailable, true);
  assert.equal(getSelfUpdateState().restartAvailable, true);
  assert.equal(consumeRestartAvailability(), true);
  assert.equal(getSelfUpdateState().restartAvailable, false);
});

test("failed command stops later commands and keeps restart unavailable", async () => {
  const calls = [];
  setSelfUpdateCommandRunnerForTests(async (command) => {
    calls.push(command.command);
    return {
      command: command.command,
      exitCode: command.command === "npm install" ? 1 : 0,
      stdout: "",
      stderr: command.command === "npm install" ? "install failed" : ""
    };
  });

  const result = await runSelfUpdate("/tmp/taskix-self-update-test");

  assert.deepEqual(calls, ["git pull", "npm install"]);
  assert.equal(result.ok, false);
  assert.equal(result.restartAvailable, false);
  assert.equal(result.failedCommand, "npm install");
  assert.equal(result.results.at(-1)?.stderr, "install failed");
  assert.equal(getSelfUpdateState().restartAvailable, false);
  assert.equal(consumeRestartAvailability(), false);
});

function localHeaders() {
  return localRequest("127.0.0.1");
}

function localRequest(ip) {
  return { headers: new Headers(), ip };
}
