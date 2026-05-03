import assert from "node:assert/strict";
import { test } from "node:test";
import { qaValidationInstruction } from "../src/lib/qa-validation-instruction.ts";

test("QA handoff instruction includes local update scope and focused validation steps", () => {
  const instruction = qaValidationInstruction(
    "https://github.com/Gitdex-AI/gitdex/pull/141",
    { githubIssueNumber: 141, title: "Run final integration checks for admin auth and self-update" },
    "abc123"
  );

  assert.match(instruction, /Expected head SHA: abc123/);
  assert.match(instruction, /local Gitdex program update validation only/);
  assert.match(instruction, /Do not validate CI\/CD, auto-merge, deployment, or user project workflow execution/);
  assert.match(instruction, /npm test/);
  assert.match(instruction, /npm run typecheck/);
  assert.match(instruction, /npm run build/);
  assert.match(instruction, /first-run setup/);
  assert.match(instruction, /initialized login protection/);
  assert.match(instruction, /protected internal APIs/);
  assert.match(instruction, /version label/);
  assert.match(instruction, /self-update failure handling/);
  assert.match(instruction, /restart confirmation/);
  assert.match(instruction, /restart polling/);
  assert.match(instruction, /page restoration/);
});
