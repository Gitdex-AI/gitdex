import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
const codex = await readFile(new URL("../src/lib/codex.ts", import.meta.url), "utf8");

test("repository workflow assigns repeatable tests to developer and coverage validation to QA", () => {
  assert.match(agents, /Developer-owned tests are the reusable verification asset/);
  assert.match(agents, /QA should not make product or test-code changes in its temporary worktree/);
  assert.match(agents, /QA should validate the submitted test cases first, assess whether they cover each acceptance criterion/);
  assert.match(agents, /future rechecks after developer fixes or rebases can be test-only/);
});

test("developer prompt requires reusable tests and rerun instructions", () => {
  assert.match(codex, /Add or update focused repeatable tests for the changed behavior whenever feasible/);
  assert.match(codex, /developer-owned tests are the reusable verification asset for QA, future fixes, and rebase retries/);
  assert.match(codex, /exact commands QA should rerun/);
});

test("QA prompt validates coverage instead of authoring throwaway tests", () => {
  assert.match(codex, /Treat submitted developer tests as the primary reusable verification asset/);
  assert.match(codex, /Do not edit product code or test code in the temporary QA worktree/);
  assert.match(codex, /If tests are missing, stale, or do not cover the acceptance criteria, fail QA as an implementation issue/);
  assert.match(codex, /whether future rechecks can be test-only or require focused manual smoke/);
});
