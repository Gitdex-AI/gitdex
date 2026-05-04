import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const codexSource = await readFile(new URL("../src/lib/codex.ts", import.meta.url), "utf8");
const architectRunnerSource = await readFile(new URL("../src/lib/architect-runner.ts", import.meta.url), "utf8");

test("reviewer review schema can report rebase-required blockers", () => {
  assert.match(
    codexSource,
    /decision:\s*\{\s*type:\s*"string",\s*enum:\s*\["ready_to_merge",\s*"changes_requested",\s*"needs_developer_rebase",\s*"blocked"\]\s*\}/
  );
  assert.match(codexSource, /Return "needs_developer_rebase" if merge readiness is blocked by conflicts/);
  assert.match(codexSource, /mergeStateStatus DIRTY/);
  assert.match(codexSource, /mergeable CONFLICTING/);
});

test("reviewer review routes rebase-required blockers to gd:rebase", () => {
  assert.match(architectRunnerSource, /const needsRebase = review\.decision === "needs_developer_rebase";/);
  assert.match(architectRunnerSource, /const nextStage = passed \? "gd:merge" : needsRebase \? "gd:rebase" : "gd:fix";/);
  assert.match(architectRunnerSource, /Reviewer returned \$\{issue\.issueId\} to developer for rebase/);
});
