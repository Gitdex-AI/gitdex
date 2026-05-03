import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveWorkflowStatus } from "../src/lib/workflow-status.ts";

const workflow = (overrides = {}) => ({
  status: "in_progress",
  issues: [],
  ...overrides
});

const issue = (overrides = {}) => ({
  issueId: "issue-1",
  title: "Issue",
  description: "Issue",
  assigneeRole: "developer",
  ownedPaths: [],
  acceptanceCriteria: [],
  labels: [],
  prLabels: [],
  githubState: null,
  prState: null,
  prUrl: null,
  ...overrides
});

describe("deriveWorkflowStatus", () => {
  it("treats closed role-only GitHub issues as completed history", () => {
    const status = deriveWorkflowStatus(workflow({
      issues: [
        issue({ issueId: "issue-115", labels: ["role:web_developer"], githubState: "CLOSED", prState: "CLOSED" }),
        issue({ issueId: "issue-116", labels: ["role:general_developer"], githubState: "CLOSED", prState: "CLOSED" })
      ]
    }));

    assert.equal(status, "done");
  });

  it("keeps blocked closed issues blocked until the blocker label is removed", () => {
    const status = deriveWorkflowStatus(workflow({
      issues: [
        issue({ labels: ["gitdex:env-blocked"], githubState: "CLOSED", prState: "CLOSED" })
      ]
    }));

    assert.equal(status, "blocked");
  });
});
