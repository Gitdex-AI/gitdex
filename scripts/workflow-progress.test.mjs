import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getWorkflowProgress } from "../src/lib/workflow-progress.ts";

const workflow = (status, issues = []) => ({ status, issues });
const job = (type, status, issueId = null) => ({ type, status, payload: { issueId } });
const issue = (overrides = {}) => ({
  issueId: "issue-1",
  labels: [],
  prLabels: [],
  prUrl: null,
  prState: null,
  ...overrides
});

const currentStep = (steps) => steps.find((step) => step.status === "current" || step.status === "running" || step.status === "blocked");
const step = (steps, id) => steps.find((item) => item.id === id);

describe("getWorkflowProgress", () => {
  it("starts empty projects at PM requirement", () => {
    const steps = getWorkflowProgress({ workflows: [], jobs: [] });

    assert.equal(currentStep(steps).id, "requirement");
    assert.equal(step(steps, "planning").status, "upcoming");
  });

  it("marks planning current when architect work is queued", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("created")],
      jobs: [job("workflow_run", "pending")]
    });

    assert.equal(currentStep(steps).id, "planning");
    assert.equal(step(steps, "requirement").status, "complete");
  });

  it("marks developer current when issue work is queued", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("planned", [issue()])],
      jobs: [job("issue_run", "pending")]
    });

    assert.equal(currentStep(steps).id, "developer");
    assert.equal(step(steps, "planning").status, "complete");
  });

  it("marks running workflow jobs on the planning step", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("created")],
      jobs: [job("workflow_run", "running")]
    });

    assert.equal(currentStep(steps).id, "planning");
    assert.equal(currentStep(steps).status, "running");
  });

  it("marks running developer jobs on the developer step", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("planned", [issue()])],
      jobs: [job("issue_run", "running")]
    });

    assert.equal(currentStep(steps).id, "developer");
    assert.equal(currentStep(steps).status, "running");
  });

  it("moves PR-backed issues to QA", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("in_progress", [issue({ prUrl: "https://example.test/pr/1", prState: "OPEN" })])],
      jobs: []
    });

    assert.equal(currentStep(steps).id, "qa");
  });

  it("marks pending QA jobs on the QA step", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("in_progress", [issue({ prUrl: "https://example.test/pr/1", prState: "OPEN" })])],
      jobs: [job("qa_run", "pending", "issue-1")]
    });

    assert.equal(currentStep(steps).id, "qa");
  });

  it("moves QA-passed issues to ready to merge", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("in_progress", [issue({ labels: ["qa-passed"], prState: "OPEN" })])],
      jobs: []
    });

    assert.equal(currentStep(steps).id, "merge");
  });

  it("shows environment-blocked issues on the QA step", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("in_progress", [issue({ labels: ["gitdex:env-blocked", "gitdex:blocked"], prUrl: "https://example.test/pr/1", prState: "OPEN" })])],
      jobs: []
    });

    assert.equal(currentStep(steps).id, "qa");
    assert.equal(currentStep(steps).status, "blocked");
  });

  it("shows completed workflows on done even when issues retain QA-passed labels", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("done", [issue({ labels: ["qa-passed"], prLabels: ["gitdex:ready-to-merge"], prState: "MERGED" })])],
      jobs: []
    });

    assert.equal(currentStep(steps), undefined);
    assert.equal(step(steps, "merge").status, "complete");
    assert.equal(step(steps, "done").status, "complete");
  });

  it("shows failed developer jobs as blocked", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("in_progress", [issue()])],
      jobs: [job("issue_run", "failed", "issue-1")]
    });

    assert.equal(currentStep(steps).id, "developer");
    assert.equal(currentStep(steps).status, "blocked");
  });

  it("ignores stale failed developer jobs after a retry reaches merge readiness", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("in_progress", [issue({ labels: ["gitdex:qa-passed"], prUrl: "https://example.test/pr/1", prState: "OPEN" })])],
      jobs: [
        job("issue_run", "failed", "issue-1"),
        job("issue_run", "done", "issue-1")
      ]
    });

    assert.equal(currentStep(steps).id, "merge");
    assert.equal(currentStep(steps).status, "current");
    assert.equal(step(steps, "developer").status, "complete");
  });
});
