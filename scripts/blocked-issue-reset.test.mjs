import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const pageSource = readFileSync("src/app/projects/[projectId]/page.tsx", "utf8");
const routeSource = readFileSync("src/app/api/projects/[projectId]/issues/[issueId]/reset-to-dev/route.ts", "utf8");
const buttonSource = readFileSync("src/components/ProjectResetBlockedIssueButton.tsx", "utf8");
const analyzeRouteSource = readFileSync("src/app/api/projects/[projectId]/issues/[issueId]/analyze-blocker/route.ts", "utf8");
const analyzeButtonSource = readFileSync("src/components/ProjectAnalyzeBlockerButton.tsx", "utf8");

describe("blocked issue reset control", () => {
  it("renders a dedicated reset button for gd:blocked issues", () => {
    assert.match(pageSource, /ProjectResetBlockedIssueButton/);
    assert.match(pageSource, /ProjectAnalyzeBlockerButton/);
    assert.match(pageSource, /input\.stage === "gd:blocked"[\s\S]*ProjectResetBlockedIssueButton/);
    assert.doesNotMatch(pageSource, /ProjectHandoffToQaButton[\s\S]*label="Reset"/);
  });

  it("resets only blocked issues back to developer stage without queuing work", () => {
    assert.match(routeSource, /getIssueStage\(issue\) !== "gd:blocked"/);
    assert.match(routeSource, /transitionIssueStage\(\{ repo: project\.githubRepo, issue, stage: "gd:dev"/);
    assert.doesNotMatch(routeSource, /createJob\(/);
    assert.doesNotMatch(routeSource, /\/jobs\/\$\{jobId\}\/run/);
  });

  it("posts to the reset endpoint and refreshes after success", () => {
    assert.match(buttonSource, /reset-to-dev/);
    assert.match(buttonSource, /router\.refresh\(\)/);
    assert.match(buttonSource, /Reset blocked issue to Dev/);
  });

  it("queues read-only blocker analysis for blocked issues", () => {
    assert.match(analyzeRouteSource, /getIssueStage\(issue\) !== "gd:blocked"/);
    assert.match(analyzeRouteSource, /type: "blocker_analysis_run"/);
    assert.match(analyzeButtonSource, /analyze-blocker/);
    assert.match(analyzeButtonSource, /\/jobs\/\$\{jobId\}\/run/);
  });
});
