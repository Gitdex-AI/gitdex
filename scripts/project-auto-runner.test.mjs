import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAutoRunDeveloper, canAutoRunQa } from "../src/lib/auto-run-policy.ts";

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
  it("allows QA-stage issues to start QA", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["gd:qa"] })), true);
  });

  it("does not start QA while QA is already running", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["gd:blocked"] })), false);
  });

  it("does not start QA for closed PRs", () => {
    assert.equal(canAutoRunQa(issue({ prState: "CLOSED" })), false);
  });

  it("does not restart QA for environment-blocked issues", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["gd:blocked"] })), false);
  });

  it("does not start QA for PRs returned for rebase", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["gd:rebase"] })), false);
  });
});

describe("canAutoRunDeveloper", () => {
  it("allows open dev-stage issues without a PR", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:dev"] })), true);
  });

  it("does not start developer work for blocked issues", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:blocked"] })), false);
  });

  it("does not start developer work for spec-blocked issues", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:architect"] })), false);
  });

  it("does not start developer work for environment-blocked issues", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:blocked"] })), false);
  });

  it("does not treat rebase-required PRs as fresh developer work", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:rebase"] })), false);
  });
});
