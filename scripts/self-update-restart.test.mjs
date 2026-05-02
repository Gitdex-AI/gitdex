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
  getTaskixServiceRestartCommand,
  requestTaskixServiceRestart,
  resetTaskixServiceRestarterForTests,
  setTaskixServiceRestarterForTests
} from "../src/lib/taskix-service.ts";

const originalFlag = process.env.TASKIX_ENABLE_SELF_UPDATE;
const originalManager = process.env.TASKIX_NEXT_SERVICE_MANAGER;
const originalServiceName = process.env.TASKIX_NEXT_SERVICE_NAME;

afterEach(() => {
  restoreEnv("TASKIX_ENABLE_SELF_UPDATE", originalFlag);
  restoreEnv("TASKIX_NEXT_SERVICE_MANAGER", originalManager);
  restoreEnv("TASKIX_NEXT_SERVICE_NAME", originalServiceName);
  resetSelfUpdateStateForTests();
  resetTaskixServiceRestarterForTests();
});

test("restart endpoint rejects requests when self-update is disabled", async () => {
  delete process.env.TASKIX_ENABLE_SELF_UPDATE;

  const response = await restartRequest(trustedRequest());

  assert.equal(response.status, 403);
  assert.match(response.error, /disabled/);
});

test("restart endpoint rejects callers without trusted localhost proof", async () => {
  process.env.TASKIX_ENABLE_SELF_UPDATE = "true";

  const response = await restartRequest({ headers: new Headers(), remoteAddress: "203.0.113.10" });

  assert.equal(response.status, 403);
  assert.match(response.error, /localhost/);
});

test("restart endpoint blocks before a successful update build", async () => {
  process.env.TASKIX_ENABLE_SELF_UPDATE = "true";

  const response = await restartRequest(trustedRequest());

  assert.equal(response.status, 409);
  assert.match(response.error, /self-update completes successfully/);
});

test("restart endpoint invokes the configured Taskix Next.js service after a successful update", async () => {
  process.env.TASKIX_ENABLE_SELF_UPDATE = "true";
  process.env.TASKIX_NEXT_SERVICE_MANAGER = "systemctl";
  process.env.TASKIX_NEXT_SERVICE_NAME = "taskix-next.service";
  const invoked = [];

  setSelfUpdateCommandRunnerForTests(async (command) => ({
    command: command.command,
    exitCode: 0,
    stdout: `${command.command} ok`,
    stderr: ""
  }));
  setTaskixServiceRestarterForTests(async (command) => {
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

  await runSelfUpdate("/tmp/taskix-self-update-restart-test");
  const response = await restartRequest(trustedRequest());

  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(response.restartRequested, true);
  assert.equal(response.manager, "systemctl");
  assert.equal(response.serviceName, "taskix-next.service");
  assert.equal(invoked.length, 1);
  assert.deepEqual(invoked[0].args, ["restart", "taskix-next.service"]);
});

test("restart endpoint reports configured service failures", async () => {
  process.env.TASKIX_ENABLE_SELF_UPDATE = "true";
  process.env.TASKIX_NEXT_SERVICE_MANAGER = "pm2";
  process.env.TASKIX_NEXT_SERVICE_NAME = "taskix-next";

  setSelfUpdateCommandRunnerForTests(async (command) => ({
    command: command.command,
    exitCode: 0,
    stdout: "",
    stderr: ""
  }));
  setTaskixServiceRestarterForTests(async (command) => ({
    ok: false,
    manager: command.manager,
    serviceName: command.serviceName,
    stdout: "",
    stderr: "pm2 failed",
    error: "Taskix service restart failed."
  }));

  await runSelfUpdate("/tmp/taskix-self-update-restart-test");
  const response = await restartRequest(trustedRequest());

  assert.equal(response.status, 500);
  assert.equal(response.restartRequested, false);
  assert.equal(response.stderr, "pm2 failed");
  assert.match(response.error, /restart failed/);
});

test("service restart config is limited to explicit Taskix service managers and names", () => {
  assert.equal(getTaskixServiceRestartCommand({ TASKIX_NEXT_SERVICE_MANAGER: "sh", TASKIX_NEXT_SERVICE_NAME: "taskix" }).ok, false);
  assert.equal(getTaskixServiceRestartCommand({ TASKIX_NEXT_SERVICE_MANAGER: "systemctl", TASKIX_NEXT_SERVICE_NAME: "other-app" }).ok, false);
  assert.equal(getTaskixServiceRestartCommand({ TASKIX_NEXT_SERVICE_MANAGER: "systemctl", TASKIX_NEXT_SERVICE_NAME: "taskix/other" }).ok, false);
  assert.equal(getTaskixServiceRestartCommand({ TASKIX_NEXT_SERVICE_MANAGER: "pm2", TASKIX_NEXT_SERVICE_NAME: "taskix-next" }).ok, true);
});

function trustedRequest() {
  return { headers: new Headers(), remoteAddress: "127.0.0.1" };
}

function restartRequest(source) {
  return requestTaskixServiceRestart({
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
