import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const smokePlan = readFileSync(new URL("./non-chat-return-browser-smoke.md", import.meta.url), "utf8");

test("non-chat return browser smoke plan covers required scenarios and commands", () => {
  assert.match(smokePlan, /npm test/);
  assert.match(smokePlan, /npm run typecheck/);
  assert.match(smokePlan, /npm run build/);
  assert.match(smokePlan, /next dev -H 127\.0\.0\.1 -p 8104/);

  assert.match(smokePlan, /Settings From Project Chat/);
  assert.match(smokePlan, /Click the left-bottom Settings icon/);
  assert.match(smokePlan, /Click the active Settings icon again/);
  assert.match(smokePlan, /in-page Back to workspace control/);

  assert.doesNotMatch(smokePlan, /Project Redirect Return/);
  assert.doesNotMatch(smokePlan, /Visit `\/projects`/);

  assert.match(smokePlan, /Tools Return/);
  assert.match(smokePlan, /Open Tools from the project workspace Settings panel/);
  assert.match(smokePlan, /Click the in-page Back control/);
  assert.match(smokePlan, /returns to the prior project chat page/);

  assert.match(smokePlan, /Unsaved Settings Confirmation/);
  assert.match(smokePlan, /Cancel the browser confirmation/);
  assert.match(smokePlan, /accept the browser confirmation/);
});
