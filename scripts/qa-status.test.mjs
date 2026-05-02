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
      issue({ labels: ["taskix:pr-opened"], prLabels: ["taskix:architect-review"] }),
      { role: "qa", status: "blocked", labels: ["taskix:qa-failed"] }
    );

    assert.equal(status.id, "not_requested");
  });

  it("still reports failed when current issue or PR labels are QA failed", () => {
    assert.equal(getIssueQaStatus(issue({ labels: ["taskix:qa-failed"] })).id, "failed");
    assert.equal(getIssueQaStatus(issue({ prLabels: ["qa-failed"] })).id, "failed");
  });
});
