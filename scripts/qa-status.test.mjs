import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getIssueQaStatus } from "../src/lib/qa-status.ts";

const issue = (overrides = {}) => ({
  labels: [],
  prLabels: [],
  ...overrides
});

describe("getIssueQaStatus", () => {
  it("uses current issue and PR labels ahead of stale QA session state", () => {
    const status = getIssueQaStatus(
      issue({ labels: ["role:web_developer"], prLabels: ["taskix:architect-review"] }),
      { role: "qa", status: "blocked", labels: ["taskix:qa-failed"] }
    );

    assert.equal(status.id, "not_requested");
  });

  it("still reports failed when current issue or PR labels are QA failed", () => {
    assert.equal(getIssueQaStatus(issue({ labels: ["taskix:qa-failed"] })).id, "failed");
    assert.equal(getIssueQaStatus(issue({ prLabels: ["qa-failed"] })).id, "failed");
  });

  it("reports spec blocked separately from implementation QA failure", () => {
    assert.equal(getIssueQaStatus(issue({ labels: ["taskix:spec-blocked", "taskix:blocked"] })).id, "spec_blocked");
  });

  it("reports environment blocked separately from implementation QA failure", () => {
    assert.equal(getIssueQaStatus(issue({ labels: ["taskix:env-blocked", "taskix:blocked"] })).id, "env_blocked");
  });
});
