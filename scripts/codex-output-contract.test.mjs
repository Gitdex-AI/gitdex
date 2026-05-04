import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../src/lib/codex.ts", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`private async ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextPrivate = source.indexOf("\n  private async ", start + 1);
  return source.slice(start, nextPrivate === -1 ? undefined : nextPrivate);
}

test("JSON-schema Codex runs do not request stdout sentinel output", () => {
  const body = functionBody("runJsonResult");

  assert.match(body, /"--output-schema"[\s\S]*schemaPath/);
  assert.doesNotMatch(body, /withAgentFinalInstruction\(prompt\)/);
  assert.match(body, /outputPath,\s*\n\s*prompt\s*\n\s*\]/);
});

test("text Codex runs keep the stdout sentinel completion protocol", () => {
  const body = functionBody("runText");

  assert.match(body, /withAgentFinalInstruction\(prompt\)/);
});
