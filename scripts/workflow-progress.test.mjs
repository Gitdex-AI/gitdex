import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getWorkflowProgress } from "../src/lib/workflow-progress.ts";

const workflow = (status, issues = []) => ({ status, issues });
const job = (type, status) => ({ type, status });
const issue = (overrides = {}) => ({
  labels: [],
  prLabels: [],
  prUrl: null,
  prState: null,
  ...overrides
});

const currentStep = (steps) => steps.find((step) => step.status === "current" || step.status === "blocked");
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

  it("moves PR-backed issues to QA", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("in_progress", [issue({ prUrl: "https://example.test/pr/1", prState: "OPEN" })])],
      jobs: []
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

  it("shows failed developer jobs as blocked", () => {
    const steps = getWorkflowProgress({
      workflows: [workflow("in_progress", [issue()])],
      jobs: [job("issue_run", "failed")]
    });

    assert.equal(currentStep(steps).id, "developer");
    assert.equal(currentStep(steps).status, "blocked");
  });
});
