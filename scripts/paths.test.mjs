import assert from "node:assert/strict";
import { test } from "node:test";

test("dataDir defaults to checkout data directory", async () => {
  delete process.env.DATA_DIR;
  const paths = await import(`../src/lib/paths.ts?default-${Date.now()}`);

  assert.equal(paths.dataDir, `${process.cwd()}/data`);
  assert.equal(paths.databasePath, `${process.cwd()}/data/gitdex.sqlite`);
});

test("dataDir honors DATA_DIR for isolated QA worktrees", async () => {
  process.env.DATA_DIR = "/private/tmp/gitdex-qa-test-data";
  const paths = await import(`../src/lib/paths.ts?custom-${Date.now()}`);

  assert.equal(paths.dataDir, "/private/tmp/gitdex-qa-test-data");
  assert.equal(paths.databasePath, "/private/tmp/gitdex-qa-test-data/gitdex.sqlite");
});
