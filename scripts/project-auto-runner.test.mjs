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
  it("allows need-qa issues to start QA", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["taskix:need-qa"] })), true);
  });

  it("does not start QA while QA is already running", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["taskix:qa-running"] })), false);
  });

  it("does not start QA for closed PRs", () => {
    assert.equal(canAutoRunQa(issue({ prState: "CLOSED" })), false);
  });

  it("does not restart QA for environment-blocked issues", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["taskix:env-blocked"] })), false);
  });
});

describe("canAutoRunDeveloper", () => {
  it("allows open issues without a PR or blocking labels", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null })), true);
  });

  it("does not start developer work for blocked issues", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["taskix:blocked"] })), false);
  });

  it("does not start developer work for spec-blocked issues", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["taskix:spec-blocked"] })), false);
  });

  it("does not start developer work for environment-blocked issues", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["taskix:env-blocked"] })), false);
  });
});
