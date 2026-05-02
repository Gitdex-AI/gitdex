import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAutoRunQa } from "../src/lib/auto-run-policy.ts";

const issue = (overrides = {}) => ({
  title: "Issue",
  description: "Issue",
  assigneeRole: "developer",
  acceptanceCriteria: [],
  issueId: "issue-1",
  githubState: "OPEN",
  prState: "OPEN",
  prUrl: "https://github.com/Taskix-AI/Taskix/pull/1",
  labels: [],
  prLabels: [],
  ...overrides
});

describe("canAutoRunQa", () => {
  it("allows need-qa issues to start QA", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["taskix:need-qa"] })), true);
  });

  it("does not start QA while QA is already running", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["taskix:qa-running"] })), false);
  });

  it("does not start QA for closed PRs", () => {
    assert.equal(canAutoRunQa(issue({ prState: "CLOSED" })), false);
  });
});
