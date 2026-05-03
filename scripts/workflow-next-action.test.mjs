import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getWorkflowNextAction } from "../src/lib/workflow-next-action.ts";

const job = (type, status) => ({ type, status });

describe("getWorkflowNextAction", () => {
  it("shows idle when there is no queued work", () => {
    const action = getWorkflowNextAction([]);

    assert.equal(action.title, "No pending work");
    assert.equal(action.buttonLabel, null);
    assert.equal(action.disabledLabel, "No Pending Work");
    assert.equal(action.tone, "idle");
  });

  it("prioritizes running jobs over pending work", () => {
    const action = getWorkflowNextAction([
      job("workflow_run", "pending"),
      job("issue_run", "pending"),
      job("issue_run", "running")
    ]);

    assert.equal(action.title, "Workflow step running");
    assert.equal(action.buttonLabel, null);
    assert.equal(action.disabledLabel, "Running");
    assert.equal(action.runningCount, 1);
  });

  it("starts developer work before additional planning", () => {
    const action = getWorkflowNextAction([
      job("workflow_run", "pending"),
      job("issue_run", "pending")
    ]);

    assert.equal(action.title, "Start next developer issue");
    assert.equal(action.buttonLabel, "Start Next Developer Issue");
    assert.equal(action.developerPending, 1);
    assert.equal(action.planningPending, 1);
  });

  it("shows the planning action for pending workflow runs", () => {
    const action = getWorkflowNextAction([job("workflow_run", "pending")]);

    assert.equal(action.title, "Run planner");
    assert.equal(action.buttonLabel, "Run Planner");
    assert.equal(action.icon, "git-branch");
  });

  it("shows the QA action for pending QA runs", () => {
    const action = getWorkflowNextAction([job("qa_run", "pending")]);

    assert.equal(action.title, "Start next QA validation");
    assert.equal(action.buttonLabel, "Start Next QA Validation");
    assert.equal(action.phase, "QA validation");
  });

  it("marks failed jobs as blocked", () => {
    const action = getWorkflowNextAction([job("issue_run", "failed")]);

    assert.equal(action.title, "Resolve blocker before continuing");
    assert.equal(action.buttonLabel, null);
    assert.equal(action.disabledLabel, "Blocked");
    assert.equal(action.tone, "blocked");
  });
});
