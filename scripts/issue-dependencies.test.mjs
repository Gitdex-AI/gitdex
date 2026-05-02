import assert from "node:assert/strict";
import { test } from "node:test";
import { findDependencyIssue, isDependencySatisfied, normalizeIssueDependenciesToNumbers } from "../src/lib/issue-dependencies.ts";

test("normalizes planning title dependencies to GitHub issue numbers", () => {
  const issues = [
    issue({ issueId: "WF-1", githubIssueNumber: 128, title: "Add guarded self-update backend workflow" }),
    issue({ issueId: "WF-2", githubIssueNumber: 129, title: "Add controlled restart endpoint", dependsOn: ["Add guarded self-update backend workflow"] })
  ];

  assert.equal(normalizeIssueDependenciesToNumbers(issues), 1);
  assert.deepEqual(issues[1].dependsOn, ["#128"]);
});

test("runtime dependency matching uses issue number or issue id, not title", () => {
  const issues = [
    issue({ issueId: "WF-1", githubIssueNumber: 128, title: "Renamed upstream", prState: "MERGED" }),
    issue({ issueId: "WF-2", githubIssueNumber: 129, title: "Downstream", dependsOn: ["#128"] })
  ];

  assert.equal(findDependencyIssue("#128", issues)?.issueId, "WF-1");
  assert.equal(findDependencyIssue("WF-1", issues)?.githubIssueNumber, 128);
  assert.equal(findDependencyIssue("Renamed upstream", issues), null);
  assert.equal(isDependencySatisfied(issues[0]), true);
});

function issue(overrides) {
  return {
    issueId: "WF-0",
    title: "Issue",
    description: "",
    assigneeRole: "developer",
    ownedPaths: [],
    acceptanceCriteria: [],
    labels: [],
    prLabels: [],
    githubState: "OPEN",
    prState: null,
    prUrl: null,
    ...overrides
  };
}
