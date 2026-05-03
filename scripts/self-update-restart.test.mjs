import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import process from "node:process";

import {
  resetSelfUpdateStateForTests,
  runSelfUpdate,
  selfUpdateGuard,
  consumeRestartAvailability,
  setSelfUpdateCommandRunnerForTests
} from "../src/lib/self-update.ts";
import {
  getGitdexServiceRestartCommand,
  requestGitdexServiceRestart,
  resetGitdexServiceRestarterForTests,
  setGitdexServiceRestarterForTests
} from "../src/lib/gitdex-service.ts";

const originalFlag = process.env.GITDEX_ENABLE_SELF_UPDATE;
const originalManager = process.env.GITDEX_NEXT_SERVICE_MANAGER;
const originalServiceName = process.env.GITDEX_NEXT_SERVICE_NAME;

afterEach(() => {
  restoreEnv("GITDEX_ENABLE_SELF_UPDATE", originalFlag);
  restoreEnv("GITDEX_NEXT_SERVICE_MANAGER", originalManager);
  restoreEnv("GITDEX_NEXT_SERVICE_NAME", originalServiceName);
  resetSelfUpdateStateForTests();
  resetGitdexServiceRestarterForTests();
});

test("restart endpoint does not require self-update flag", async () => {
  delete process.env.GITDEX_ENABLE_SELF_UPDATE;

  const response = await restartRequest(trustedRequest());

  assert.equal(response.status, 409);
  assert.match(response.error, /self-update completes successfully/);
});

test("restart endpoint does not require trusted localhost proof", async () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  const response = await restartRequest({ headers: new Headers(), remoteAddress: "203.0.113.10" });

  assert.equal(response.status, 409);
  assert.match(response.error, /self-update completes successfully/);
});

test("restart endpoint blocks before a successful update build", async () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";

  const response = await restartRequest(trustedRequest());

  assert.equal(response.status, 409);
  assert.match(response.error, /self-update completes successfully/);
});

test("restart endpoint invokes the configured Gitdex Next.js service after a successful update", async () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";
  process.env.GITDEX_NEXT_SERVICE_MANAGER = "systemctl";
  process.env.GITDEX_NEXT_SERVICE_NAME = "gitdex-next.service";
  const invoked = [];

  setSelfUpdateCommandRunnerForTests(async (command) => ({
    command: command.command,
    exitCode: 0,
    stdout: `${command.command} ok`,
    stderr: ""
  }));
  setGitdexServiceRestarterForTests(async (command) => {
    invoked.push(command);
    return {
      ok: true,
      manager: command.manager,
      serviceName: command.serviceName,
      stdout: "restarted",
      stderr: "",
      error: null
    };
  });

  await runSelfUpdate("/tmp/gitdex-self-update-restart-test");
  const response = await restartRequest(trustedRequest());

  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(response.restartRequested, true);
  assert.equal(response.manager, "systemctl");
  assert.equal(response.serviceName, "gitdex-next.service");
  assert.equal(invoked.length, 1);
  assert.deepEqual(invoked[0].args, ["restart", "gitdex-next.service"]);
});

test("restart endpoint reports configured service failures", async () => {
  process.env.GITDEX_ENABLE_SELF_UPDATE = "true";
  process.env.GITDEX_NEXT_SERVICE_MANAGER = "pm2";
  process.env.GITDEX_NEXT_SERVICE_NAME = "gitdex-next";

  setSelfUpdateCommandRunnerForTests(async (command) => ({
    command: command.command,
    exitCode: 0,
    stdout: "",
    stderr: ""
  }));
  setGitdexServiceRestarterForTests(async (command) => ({
    ok: false,
    manager: command.manager,
    serviceName: command.serviceName,
    stdout: "",
    stderr: "pm2 failed",
    error: "Gitdex service restart failed."
  }));

  await runSelfUpdate("/tmp/gitdex-self-update-restart-test");
  const response = await restartRequest(trustedRequest());

  assert.equal(response.status, 500);
  assert.equal(response.restartRequested, false);
  assert.equal(response.stderr, "pm2 failed");
  assert.match(response.error, /restart failed/);
});

test("service restart config is limited to explicit Gitdex service managers and names", () => {
  assert.equal(getGitdexServiceRestartCommand({ GITDEX_NEXT_SERVICE_MANAGER: "sh", GITDEX_NEXT_SERVICE_NAME: "gitdex" }).ok, false);
  assert.equal(getGitdexServiceRestartCommand({ GITDEX_NEXT_SERVICE_MANAGER: "systemctl", GITDEX_NEXT_SERVICE_NAME: "other-app" }).ok, false);
  assert.equal(getGitdexServiceRestartCommand({ GITDEX_NEXT_SERVICE_MANAGER: "systemctl", GITDEX_NEXT_SERVICE_NAME: "gitdex/other" }).ok, false);
  assert.equal(getGitdexServiceRestartCommand({ GITDEX_NEXT_SERVICE_MANAGER: "pm2", GITDEX_NEXT_SERVICE_NAME: "gitdex-next" }).ok, true);
});

function trustedRequest() {
  return { headers: new Headers(), remoteAddress: "127.0.0.1" };
}

function restartRequest(source) {
  return requestGitdexServiceRestart({
    source,
    guard: selfUpdateGuard,
    consumeRestartAvailability
  });
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
