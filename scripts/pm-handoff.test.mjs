import assert from "node:assert/strict";
import test from "node:test";
import { parseStartNewRequirementAction } from "../src/lib/pm-handoff.ts";

test("parseStartNewRequirementAction extracts PM new requirement decisions", () => {
  const payload = parseStartNewRequirementAction(`
This looks separate.

\`\`\`json
{
  "status": "needs_user_decision",
  "action": "start_new_requirement",
  "reason": "The user is asking for a separate settings workflow.",
  "question": "This looks like a new requirement. How should I handle it?",
  "options": [
    { "id": "start_new_requirement", "label": "Start new requirement", "draftMessage": "Add settings return behavior." },
    { "id": "keep_current", "label": "Keep in current chat" },
    { "id": "clarify", "label": "Clarify first" }
  ]
}
\`\`\`
`);

  assert.equal(payload?.action, "start_new_requirement");
  assert.equal(payload?.options[0]?.draftMessage, "Add settings return behavior.");
});
