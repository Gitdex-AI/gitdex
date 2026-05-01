import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  recoveryReasonForDeveloperStep,
  recoveryReasonForJobs,
  recoveryReasonForMergeStep,
  recoveryReasonForQaStep
} from "../src/lib/workflow-recovery.ts";

const workflow = (issues = []) => ({ issues });
const issue = (overrides = {}) => ({
  branch: null,
  labels: [],
  prLabels: [],
  prState: null,
  prUrl: null,
  ...overrides
});
const job = (type, status) => ({ type, status });
const session = (status) => ({ status });

describe("workflow recovery reasons", () => {
  it("shows QA recovery when an open PR has no QA labels", () => {
    const reason = recoveryReasonForQaStep([
      workflow([issue({ prUrl: "https://github.com/Taskix-AI/Taskix/pull/111", prState: "OPEN" })])
    ], []);

    assert.match(reason, /QA labels are missing/);
  });

  it("shows QA recovery when only open PR state is known", () => {
    const reason = recoveryReasonForQaStep([
      workflow([issue({ prState: "OPEN" })])
    ], []);

    assert.match(reason, /QA labels are missing/);
  });

  it("does not show missing-label QA recovery once QA has passed", () => {
    const reason = recoveryReasonForQaStep([
      workflow([issue({ labels: ["qa-passed"], prUrl: "https://example.test/pr/1", prState: "OPEN" })])
    ], []);

    assert.equal(reason, null);
  });

  it("shows QA wait recovery for issues needing QA", () => {
    const reason = recoveryReasonForQaStep([
      workflow([issue({ labels: ["taskix:need-qa"], prUrl: "https://example.test/pr/1", prState: "OPEN" })])
    ], []);

    assert.match(reason, /waiting on QA labels/);
  });

  it("shows planning recovery for failed jobs", () => {
    assert.match(recoveryReasonForJobs([job("workflow_run", "failed")]), /planning job failed/);
  });

  it("shows developer recovery for failed jobs and blocked sessions", () => {
    assert.match(recoveryReasonForDeveloperStep([], [job("issue_run", "failed")], []), /developer job failed/);
    assert.match(recoveryReasonForDeveloperStep([], [], [session("blocked")]), /developer session is blocked/);
  });

  it("shows merge recovery for QA-passed open PRs", () => {
    const reason = recoveryReasonForMergeStep([
      workflow([issue({ labels: ["qa-passed"], prState: "OPEN" })])
    ]);

    assert.match(reason, /ready/);
  });
});
