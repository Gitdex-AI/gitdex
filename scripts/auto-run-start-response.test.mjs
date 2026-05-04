import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const routeSource = await readFile(new URL("../src/app/api/projects/[projectId]/issues/auto-run/route.ts", import.meta.url), "utf8");
const runnerSource = await readFile(new URL("../src/lib/project-auto-runner.ts", import.meta.url), "utf8");

test("auto-run API records running state and returns before background execution completes", () => {
  assert.match(routeSource, /const state = startAutoRunState\(project\.projectId, \{ workflowIds, issueIds \}\);/);
  assert.match(routeSource, /void runProjectIssueAutoRun\(project, \{ workflowIds, issueIds, initialState: state \}\)\.catch/);
  assert.match(routeSource, /return NextResponse\.json\(\{ ok: true, completed: false, steps: \[\], message: "Auto Run started\.", state \}\);/);
  assert.doesNotMatch(routeSource, /const result = await runProjectIssueAutoRun/);
});

test("auto-run runner can continue from an already persisted state", () => {
  assert.match(runnerSource, /initialState\?: AutoRunState/);
  assert.match(runnerSource, /const runState = options\.initialState \?\? startAutoRunState/);
});
