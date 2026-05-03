import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyStageLabels, deriveIssueAction, deriveIssueStage, getIssueStage } from "../src/lib/issue-stage.ts";

const issue = (overrides = {}) => ({
  title: "Issue",
  description: "Issue",
  assigneeRole: "developer",
  acceptanceCriteria: [],
  issueId: "issue-1",
  githubState: "OPEN",
  prState: null,
  prUrl: null,
  labels: [],
  prLabels: [],
  ...overrides
});

describe("deriveIssueStage", () => {
  it("migrates old need-qa labels to gd:qa", () => {
    const result = deriveIssueStage({ labels: ["taskix:need-qa", "role:web_developer"], prUrl: "https://example.test/pull/1" });
    assert.equal(result.stage, "gd:qa");
    assert.deepEqual(result.addLabels, ["gd:qa"]);
    assert.deepEqual(result.removeLabels, ["taskix:need-qa"]);
  });

  it("keeps only one gd stage when labels conflict", () => {
    const result = deriveIssueStage({ labels: ["gd:qa", "gd:merge"], prUrl: "https://example.test/pull/1" });
    assert.equal(result.stage, "gd:merge");
    assert.deepEqual(result.removeLabels, ["gd:qa"]);
    assert.equal(result.conflicted, true);
  });

  it("treats merged PRs as done", () => {
    assert.equal(getIssueStage(issue({ labels: ["gd:merge"], prState: "MERGED" })), "gd:done");
  });

  it("infers QA for open PRs without an issue stage", () => {
    assert.equal(getIssueStage(issue({ prUrl: "https://example.test/pull/1", prState: "OPEN" })), "gd:qa");
  });
});

describe("deriveIssueAction", () => {
  it("maps gd stages to runnable actions", () => {
    assert.equal(deriveIssueAction(issue({ labels: ["gd:dev"] })).action, "run_dev");
    assert.equal(deriveIssueAction(issue({ labels: ["gd:fix"], prUrl: "https://example.test/pull/1" })).action, "run_dev");
    assert.equal(deriveIssueAction(issue({ labels: ["gd:rebase"], prUrl: "https://example.test/pull/1" })).action, "run_dev");
    assert.equal(deriveIssueAction(issue({ labels: ["gd:qa"], prUrl: "https://example.test/pull/1" })).action, "run_qa");
    assert.equal(deriveIssueAction(issue({ labels: ["gd:review"], prUrl: "https://example.test/pull/1" })).action, "run_review");
    assert.equal(deriveIssueAction(issue({ labels: ["gd:merge"], prUrl: "https://example.test/pull/1" })).action, "run_merge");
    assert.equal(deriveIssueAction(issue({ labels: ["gd:architect"] })).action, "run_architect");
    assert.equal(deriveIssueAction(issue({ labels: ["gd:blocked"] })).action, "resolve");
    assert.equal(deriveIssueAction(issue({ labels: ["gd:done"] })).action, "none");
  });
});

describe("applyStageLabels", () => {
  it("removes old workflow labels while preserving role labels", () => {
    assert.deepEqual(
      applyStageLabels(["taskix:need-qa", "gd:merge", "role:web_developer"], "gd:qa"),
      ["role:web_developer", "gd:qa"]
    );
  });
});
