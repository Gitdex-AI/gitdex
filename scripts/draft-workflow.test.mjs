import assert from "node:assert/strict";
import test from "node:test";
import { isDiscardableDraftWorkflow, latestReusableDraftWorkflow } from "../src/lib/draft-workflow.ts";

const workflow = (overrides = {}) => ({
  workflowId: "wf",
  trackingCode: null,
  userRequirement: "Untitled requirement",
  status: "created",
  chatId: 0,
  createdAt: "2026-05-01T00:00:00.000Z",
  projectId: "project-a",
  projectName: "Project A",
  issues: [],
  timeline: [],
  ...overrides
});

test("latestReusableDraftWorkflow picks the latest unconfirmed empty draft for the project", () => {
  const selected = latestReusableDraftWorkflow("project-a", [
    workflow({ workflowId: "older", createdAt: "2026-05-01T00:00:00.000Z" }),
    workflow({ workflowId: "other-project", projectId: "project-b", createdAt: "2026-05-03T00:00:00.000Z" }),
    workflow({ workflowId: "confirmed", trackingCode: "WF-20260501-001", createdAt: "2026-05-04T00:00:00.000Z" }),
    workflow({ workflowId: "newer", createdAt: "2026-05-02T00:00:00.000Z" })
  ]);

  assert.equal(selected?.workflowId, "newer");
});

test("latestReusableDraftWorkflow ignores drafts that already entered workflow execution", () => {
  const selected = latestReusableDraftWorkflow("project-a", [
    workflow({ workflowId: "planned", status: "planned" }),
    workflow({ workflowId: "has-issues", issues: [{ issueId: "issue-1" }] })
  ]);

  assert.equal(selected, null);
});

test("isDiscardableDraftWorkflow allows only unconfirmed empty project drafts", () => {
  assert.equal(isDiscardableDraftWorkflow("project-a", workflow()), true);
  assert.equal(isDiscardableDraftWorkflow("project-a", workflow({ trackingCode: "WF-20260501-001" })), false);
  assert.equal(isDiscardableDraftWorkflow("project-a", workflow({ issues: [{ issueId: "issue-1" }] })), false);
  assert.equal(isDiscardableDraftWorkflow("project-a", workflow({ projectId: "project-b" })), false);
});
