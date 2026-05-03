import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

import {
  consumeRestartAvailability,
  getSelfUpdateState,
  requestConfirmedSelfUpdateRestart,
  resetSelfUpdateStateForTests,
  runConfirmedSelfUpdate,
  selfUpdateGuard,
  setSelfUpdateCommandRunnerForTests
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

test("admin self-update routes require console API authentication", async () => {
  const routeFiles = [
    "src/app/api/admin/self-update/route.ts",
    "src/app/api/admin/self-update/update/route.ts",
    "src/app/api/admin/self-update/restart/route.ts",
    "src/app/api/self-update/update/route.ts",
    "src/app/api/self-update/restart/route.ts",
    "src/app/api/operator/self-update/update/route.ts",
    "src/app/api/operator/self-update/restart/route.ts"
  ];

  for (const routeFile of routeFiles) {
    const source = await readFile(routeFile, "utf8");
    assert.match(source, /requireConsoleApiAuth/, `${routeFile} must call the admin auth guard`);
  }
});

test("all self-update mutation routes require confirmation before running commands or restart", async () => {
  const updateRoutes = [
    "src/app/api/admin/self-update/update/route.ts",
    "src/app/api/self-update/update/route.ts",
    "src/app/api/operator/self-update/update/route.ts"
  ];
  const restartRoutes = [
    "src/app/api/admin/self-update/restart/route.ts",
    "src/app/api/self-update/restart/route.ts",
    "src/app/api/operator/self-update/restart/route.ts"
  ];

  for (const routeFile of updateRoutes) {
    const source = await readFile(routeFile, "utf8");
    assert.match(source, /runConfirmedSelfUpdate|runOperatorSelfUpdate/, `${routeFile} must require update confirmation`);
    assert.doesNotMatch(source, /runSelfUpdate\(/, `${routeFile} must not run updates without confirmation`);
    assert.doesNotMatch(source, /restartGitdexService/, `${routeFile} must not request restart during update`);
  }

  for (const routeFile of restartRoutes) {
    const source = await readFile(routeFile, "utf8");
    assert.match(source, /requestConfirmedSelfUpdateRestart/, `${routeFile} must require restart confirmation`);
    assert.doesNotMatch(source, /requestGitdexServiceRestart/, `${routeFile} must not restart without confirmation`);
  }
});

test("confirmed self-update does not require flag or localhost guard and runs commands in order", async () => {
  delete process.env.GITDEX_ENABLE_SELF_UPDATE;

  const calls = [];
  setSelfUpdateCommandRunnerForTests(async (command) => {
    calls.push(command.command);
    return { command: command.command, exitCode: 0, stdout: `${command.command} ok`, stderr: "" };
  });

  assert.equal(selfUpdateGuard(new Headers({ host: "example.com" })).ok, true);

  const response = await runConfirmedSelfUpdate({ confirmed: true }, "/tmp/gitdex-self-update-confirmed-test");

  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.deepEqual(calls, ["git pull", "npm install", "npm run build"]);
  assert.equal(response.result?.restartAvailable, true);
  assert.equal(getSelfUpdateState().restartAvailable, true);
});

test("confirmed self-update rejects missing confirmation before running commands", async () => {
  const calls = [];
  setSelfUpdateCommandRunnerForTests(async (command) => {
    calls.push(command.command);
    return { command: command.command, exitCode: 0, stdout: "", stderr: "" };
  });

  const response = await runConfirmedSelfUpdate({}, "/tmp/gitdex-self-update-missing-confirmation-test");

  assert.equal(response.status, 400);
  assert.equal(response.ok, false);
  assert.match(response.error, /confirmation/i);
  assert.deepEqual(calls, []);
});

test("failed self-update identifies the failed command and keeps restart unavailable", async () => {
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

  const response = await runConfirmedSelfUpdate({ confirmed: true }, "/tmp/gitdex-self-update-failure-test");

  assert.equal(response.status, 500);
  assert.equal(response.ok, false);
  assert.match(response.error, /npm install/);
  assert.deepEqual(calls, ["git pull", "npm install"]);
  assert.equal(response.result?.failedCommand, "npm install");
  assert.equal(response.result?.restartAvailable, false);
  assert.equal(consumeRestartAvailability(), false);
});

test("restart requires a second confirmation and successful update eligibility", async () => {
  let restartCalls = 0;
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

  const unconfirmed = await requestConfirmedSelfUpdateRestart({}, restartGitdexService);
  assert.equal(unconfirmed.status, 400);
  assert.equal(restartCalls, 0);

  const unavailable = await requestConfirmedSelfUpdateRestart({ confirmed: true }, restartGitdexService);
  assert.equal(unavailable.status, 409);
  assert.equal(restartCalls, 0);

  setSelfUpdateCommandRunnerForTests(async (command) => {
    return { command: command.command, exitCode: 0, stdout: `${command.command} ok`, stderr: "" };
  });
  await runConfirmedSelfUpdate({ confirmed: true }, "/tmp/gitdex-self-update-restart-confirmation-test");

  const restarted = await requestConfirmedSelfUpdateRestart({ confirmed: true }, restartGitdexService);
  assert.equal(restarted.status, 200);
  assert.equal(restarted.ok, true);
  assert.equal(restarted.restart?.restartRequested, true);
  assert.equal(restartCalls, 1);
  assert.equal(getSelfUpdateState().restartStatus, "requested");
  assert.equal(getSelfUpdateState().restartAvailable, false);
});
