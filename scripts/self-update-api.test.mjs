import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import process from "node:process";
import { NextRequest } from "next/server.js";

import {
  consumeRestartAvailability,
  getSelfUpdateState,
  isSelfUpdateEnabled,
  isLocalhostRequest,
  hasTrustedCallerAddress,
  mintSelfUpdateOperatorIntent,
  requestConfirmedSelfUpdateRestart,
  resetSelfUpdateStateForTests,
  runOperatorSelfUpdate,
  runSelfUpdate,
  selfUpdateGuard,
  setSelfUpdateCommandRunnerForTests,
  setSelfUpdateOperatorIntentClockForTests,
  validateSelfUpdateOperatorIntent
} from "../src/lib/self-update.ts";

const originalFlag = process.env.GITDEX_ENABLE_SELF_UPDATE;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.GITDEX_ENABLE_SELF_UPDATE;
  } else {
    process.env.GITDEX_ENABLE_SELF_UPDATE = originalFlag;
  }
  resetSelfUpdateStateForTests();
});

test("self-update does not require an enablement flag", () => {
  delete process.env.GITDEX_ENABLE_SELF_UPDATE;

  const guard = selfUpdateGuard(localHeaders());

  assert.equal(guard.ok, true);
});

test("self-update enablement state defaults to available", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "TRUE";
  assert.equal(isSelfUpdateEnabled(), true);

  process.env.GITDEX_ENABLE_SELF_UPDATE = "false";
  assert.equal(isSelfUpdateEnabled(), false);
});

test("self-update guard does not require localhost callers", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  const guard = selfUpdateGuard(new Headers({ "x-forwarded-for": "203.0.113.10", host: "example.com" }));

  assert.equal(guard.ok, true);
});

test("host headers do not prove a localhost caller", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  assert.equal(isLocalhostRequest(new Headers({ host: "127.0.0.1:8000" })), false);
  assert.equal(isLocalhostRequest(new Headers({ "x-forwarded-host": "127.0.0.1:8000" })), false);
  assert.equal(selfUpdateGuard(new Headers({ host: "127.0.0.1:8000" })).ok, true);
});

test("forwarding headers do not prove a localhost caller", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  assert.equal(isLocalhostRequest(new Headers({ "x-forwarded-for": "127.0.0.1" })), false);
  assert.equal(isLocalhostRequest(new Headers({ "x-real-ip": "127.0.0.1" })), false);
  assert.equal(selfUpdateGuard(new Headers({ "x-forwarded-for": "127.0.0.1" })).ok, true);
});

test("plain request URLs do not prove a localhost caller", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  assert.equal(
    isLocalhostRequest({
      headers: new Headers({ host: "127.0.0.1:8000" }),
      url: "http://127.0.0.1:8000/api/self-update"
    }),
    false
  );
});

test("next route localhost URLs do not affect self-update guard authorization", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  assert.equal(
    selfUpdateGuard(new NextRequest("http://127.0.0.1:8000/api/self-update/update", { method: "POST" })).ok,
    true
  );
  assert.equal(
    selfUpdateGuard(
      new NextRequest("http://127.0.0.1:8000/api/self-update/update", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10", host: "example.com" }
      })
    ).ok,
    true
  );
  assert.equal(
    selfUpdateGuard(
      new NextRequest("http://localhost:8000/api/self-update/update", {
        method: "POST",
        headers: { host: "127.0.0.1:8000" }
      })
    ).ok,
    true
  );
});

test("self-update state reports trusted caller validation availability", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  const routeRequest = new NextRequest("http://127.0.0.1:8000/api/self-update");
  const trustedRequest = {
    headers: new Headers({ host: "example.com" }),
    remoteAddress: "127.0.0.1"
  };

  assert.equal(hasTrustedCallerAddress(routeRequest), false);
  assert.deepEqual(
    pickValidationState(getSelfUpdateState(routeRequest)),
    {
      trustedCallerAddressAvailable: false,
      trustedLocalhostCallerValidated: false
    }
  );
  assert.equal(hasTrustedCallerAddress(trustedRequest), true);
  assert.deepEqual(
    pickValidationState(getSelfUpdateState(trustedRequest)),
    {
      trustedCallerAddressAvailable: true,
      trustedLocalhostCallerValidated: true
    }
  );
});

test("self-update state exposes operator submission and boot readiness markers", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  const state = getSelfUpdateState(new NextRequest("http://127.0.0.1:8000/api/self-update"));

  assert.equal(state.operatorSubmissionAvailable, true);
  assert.equal(typeof state.operatorIntentToken, "string");
  assert.equal(typeof state.bootId, "string");
  assert.equal(typeof state.startedAt, "string");
  assert.equal(state.restartStatus, "idle");
});

test("operator intent validation rejects missing stale and invalid tokens", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  const firstIntent = mintSelfUpdateOperatorIntent();
  const secondIntent = mintSelfUpdateOperatorIntent();

  assert.ok(firstIntent);
  assert.ok(secondIntent);
  assert.equal(validateSelfUpdateOperatorIntent({ nonce: firstIntent.cookie.value, token: null }).ok, false);
  assert.equal(validateSelfUpdateOperatorIntent({ nonce: firstIntent.cookie.value, token: "invalid" }).ok, false);
  assert.equal(
    validateSelfUpdateOperatorIntent({ nonce: secondIntent.cookie.value, token: firstIntent.token }).ok,
    false
  );
  assert.equal(
    validateSelfUpdateOperatorIntent({ nonce: firstIntent.cookie.value, token: firstIntent.token }).ok,
    false
  );
  assert.equal(
    validateSelfUpdateOperatorIntent({ nonce: secondIntent.cookie.value, token: secondIntent.token }).ok,
    true
  );
  assert.equal(
    validateSelfUpdateOperatorIntent({ nonce: secondIntent.cookie.value, token: secondIntent.token }).ok,
    false
  );
});

test("operator intent validation rejects expired tokens", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";
  let now = 1_000;
  setSelfUpdateOperatorIntentClockForTests(() => now);

  const intent = mintSelfUpdateOperatorIntent();
  assert.ok(intent);

  now += intent.cookie.maxAge * 1000 + 1;

  assert.equal(validateSelfUpdateOperatorIntent({ nonce: intent.cookie.value, token: intent.token }).ok, false);
});

test("operator self-update flow requires a valid server-minted intent token", async () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";
  const calls = [];
  setSelfUpdateCommandRunnerForTests(async (command) => {
    calls.push(command.command);
    return { command: command.command, exitCode: 0, stdout: `${command.command} ok`, stderr: "" };
  });

  const missing = await runOperatorSelfUpdate({ nonce: null, token: null }, "/tmp/gitdex-self-update-operator-test");
  assert.equal(missing.status, 403);

  const intent = mintSelfUpdateOperatorIntent();
  assert.ok(intent);

  const stale = await runOperatorSelfUpdate(
    { nonce: "stale", token: intent.token },
    "/tmp/gitdex-self-update-operator-test"
  );
  assert.equal(stale.status, 403);

  const accepted = await runOperatorSelfUpdate(
    { nonce: intent.cookie.value, token: intent.token },
    "/tmp/gitdex-self-update-operator-test"
  );

  assert.equal(accepted.status, 200);
  assert.deepEqual(calls, ["git pull", "npm install", "npm run build"]);

  const replay = await runOperatorSelfUpdate(
    { nonce: intent.cookie.value, token: intent.token },
    "/tmp/gitdex-self-update-operator-test"
  );
  assert.equal(replay.status, 403);
  assert.deepEqual(calls, ["git pull", "npm install", "npm run build"]);
});

test("operator self-update flow runs update only and leaves restart available", async () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  const calls = [];
  let restartCalls = 0;
  setSelfUpdateCommandRunnerForTests(async (command) => {
    calls.push(command.command);
    return { command: command.command, exitCode: 0, stdout: `${command.command} ok`, stderr: "" };
  });
  const restartGitdexService = async () => {
    restartCalls += 1;
    return {
      ok: true,
      manager: "systemctl",
      serviceName: "gitdex-next.service",
      stdout: "restarted",
      stderr: "",
      error: null
    };
  };

  const intent = mintSelfUpdateOperatorIntent();
  assert.ok(intent);

  const response = await runOperatorSelfUpdate(
    { nonce: intent.cookie.value, token: intent.token },
    "/tmp/gitdex-self-update-operator-restart-test"
  );

  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(response.result?.ok, true);
  assert.equal(response.result?.restartAvailable, true);
  assert.deepEqual(calls, ["git pull", "npm install", "npm run build"]);
  assert.equal(restartCalls, 0);
  assert.equal(getSelfUpdateState().restartStatus, "idle");
  assert.equal(getSelfUpdateState().restartAvailable, true);

  const restarted = await requestConfirmedSelfUpdateRestart({ confirmed: true }, restartGitdexService);
  assert.equal(restarted.status, 200);
  assert.equal(restarted.restart?.restartRequested, true);
  assert.equal(restartCalls, 1);
  assert.equal(getSelfUpdateState().restartStatus, "requested");
  assert.equal(getSelfUpdateState().restartAvailable, false);
});

test("operator self-update restart requires a separate confirmation after update success", async () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  let restartCalls = 0;
  setSelfUpdateCommandRunnerForTests(async (command) => {
    return { command: command.command, exitCode: 0, stdout: `${command.command} ok`, stderr: "" };
  });
  const restartGitdexService = async () => {
    restartCalls += 1;
    return {
      ok: true,
      manager: "systemctl",
      serviceName: "gitdex-next.service",
      stdout: "restarted",
      stderr: "",
      error: null
    };
  };

  const intent = mintSelfUpdateOperatorIntent();
  assert.ok(intent);

  const response = await runOperatorSelfUpdate(
    { nonce: intent.cookie.value, token: intent.token },
    "/tmp/gitdex-self-update-operator-restart-failure-test"
  );
  assert.equal(response.status, 200);
  assert.equal(getSelfUpdateState().restartAvailable, true);

  const replayedUpdateIntent = await requestConfirmedSelfUpdateRestart(
    { operatorIntentToken: intent.token },
    restartGitdexService
  );
  assert.equal(replayedUpdateIntent.status, 400);
  assert.equal(restartCalls, 0);
  assert.equal(getSelfUpdateState().restartAvailable, true);

  const missingConfirmation = await requestConfirmedSelfUpdateRestart({}, restartGitdexService);
  assert.equal(missingConfirmation.status, 400);
  assert.equal(restartCalls, 0);
  assert.equal(getSelfUpdateState().restartAvailable, true);

  const confirmed = await requestConfirmedSelfUpdateRestart({ confirmed: true }, restartGitdexService);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.restart?.restartRequested, true);
  assert.equal(restartCalls, 1);
});

test("runtime loopback addresses prove localhost route callers", () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  assert.equal(
    isLocalhostRequest({
      headers: new Headers({ host: "example.com" }),
      url: "http://example.com/api/self-update",
      ip: "127.0.0.1"
    }),
    true
  );
  assert.equal(
    selfUpdateGuard({
      headers: new Headers({ "x-forwarded-for": "127.0.0.1", host: "127.0.0.1:8000" }),
      url: "http://127.0.0.1:8000/api/self-update",
      remoteAddress: "127.0.0.1"
    }).ok,
    true
  );
});

test("localhost detection accepts loopback address forms", () => {
  assert.equal(isLocalhostRequest(localRequest("127.0.0.1")), true);
  assert.equal(isLocalhostRequest(localRequest("::1")), true);
  assert.equal(isLocalhostRequest(localRequest("::ffff:127.0.0.1")), true);
  assert.equal(isLocalhostRequest(localRequest("localhost")), false);
});

test("successful update runs commands in order and enables restart", async () => {
  const calls = [];
  setSelfUpdateCommandRunnerForTests(async (command) => {
    calls.push(command.command);
    return { command: command.command, exitCode: 0, stdout: `${command.command} ok`, stderr: "" };
  });

  const result = await runSelfUpdate("/tmp/gitdex-self-update-test");

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

  const result = await runSelfUpdate("/tmp/gitdex-self-update-test");

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

function pickValidationState(state) {
  return {
    trustedCallerAddressAvailable: state.trustedCallerAddressAvailable,
    trustedLocalhostCallerValidated: state.trustedLocalhostCallerValidated
  };
}
