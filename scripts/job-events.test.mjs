import assert from "node:assert/strict";
import test from "node:test";
import { publishJobEvent, subscribeProjectJobEvents } from "../src/lib/job-events.ts";

function job(jobId, projectId) {
  const now = new Date().toISOString();
  return {
    jobId,
    projectId,
    type: "issue_run",
    status: "running",
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    payload: { workflowId: "WF-test", issueId: "issue-test" }
  };
}

test("project job event subscriptions only receive matching project jobs", () => {
  const received = [];
  const unsubscribe = subscribeProjectJobEvents("project-a", (eventJob) => {
    received.push(eventJob.jobId);
  });

  publishJobEvent(job("job-a", "project-a"));
  publishJobEvent(job("job-b", "project-b"));
  unsubscribe();
  publishJobEvent(job("job-c", "project-a"));

  assert.deepEqual(received, ["job-a"]);
});
