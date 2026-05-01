import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyTriageIssue } from "../src/lib/triage-classifier.ts";

const classify = (overrides = {}) => classifyTriageIssue({
  issueState: "OPEN",
  issueLabels: [],
  primaryLinkedPrState: null,
  primaryLinkedPrLabels: [],
  ...overrides
});

describe("classifyTriageIssue", () => {
  it("keeps closed blocked issues in blocked instead of done", () => {
    assert.equal(classify({
      issueState: "CLOSED",
      issueLabels: ["taskix:blocked"]
    }), "blocked");
  });

  it("keeps closed QA-failed issues in blocked instead of done", () => {
    assert.equal(classify({
      issueState: "CLOSED",
      issueLabels: ["taskix:qa-failed"]
    }), "blocked");

    assert.equal(classify({
      issueState: "CLOSED",
      issueLabels: ["qa-failed"]
    }), "blocked");
  });

  it("treats linked PR failed labels as blocked even when the issue is closed", () => {
    assert.equal(classify({
      issueState: "CLOSED",
      primaryLinkedPrLabels: ["taskix:qa-failed"]
    }), "blocked");
  });

  it("still marks closed unblocked issues as done", () => {
    assert.equal(classify({
      issueState: "CLOSED",
      issueLabels: ["qa-passed"]
    }), "done");
  });

  it("keeps merged linked PRs as done when no blocked labels exist", () => {
    assert.equal(classify({
      primaryLinkedPrState: "MERGED",
      primaryLinkedPrLabels: ["taskix:qa-passed"]
    }), "done");
  });
});
