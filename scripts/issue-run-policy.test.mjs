import assert from "node:assert/strict";
import {
  expectedDeveloperBranch,
  manualDeployArchitectPolicyDecision,
  manualDeployFinalLabelPlan,
  prRecoveryBranches
} from "../src/lib/issue-run-policy.ts";

const workflowCode = "WF-20260501-999";
const issueNumber = 123;
const expectedBranch = `taskix/${workflowCode}-issue-${issueNumber}`;

assert.equal(expectedDeveloperBranch(workflowCode, issueNumber), expectedBranch);

assert.deepEqual(
  prRecoveryBranches({ developerBranch: "", workflowCode, issueNumberOrId: issueNumber }),
  [expectedBranch],
  "empty developer branch should fall back to deterministic workflow branch"
);

assert.deepEqual(
  prRecoveryBranches({ developerBranch: expectedBranch, workflowCode, issueNumberOrId: issueNumber }),
  [expectedBranch],
  "duplicate developer/expected branch should be de-duplicated"
);

const ready = manualDeployFinalLabelPlan({
  prUrl: "https://github.com/Taskix-AI/Taskix/pull/999",
  architectDecision: manualDeployArchitectPolicyDecision({
    prUrl: "https://github.com/Taskix-AI/Taskix/pull/999",
    qaPassed: true,
    prState: "OPEN",
    prMerged: false
  })
});

assert.equal(ready.decision, "ready_to_merge");
assert.deepEqual(ready.labelsApplied, ["taskix:ready-to-merge"]);
assert.deepEqual(ready.labelsRemoved, ["taskix:need-qa", "taskix:qa-running", "taskix:blocked"]);
assert.match(ready.summary, /without merging it/);

const blocked = manualDeployFinalLabelPlan({
  prUrl: "https://github.com/Taskix-AI/Taskix/pull/999",
  architectDecision: manualDeployArchitectPolicyDecision({
    prUrl: "https://github.com/Taskix-AI/Taskix/pull/999",
    qaPassed: false,
    prState: "OPEN",
    prMerged: false
  })
});

assert.equal(blocked.decision, "blocked");
assert.deepEqual(blocked.labelsApplied, ["taskix:blocked"]);
assert.deepEqual(blocked.labelsRemoved, ["taskix:qa-running", "taskix:ready-to-merge"]);
assert.match(blocked.summary, /QA has not passed/);

const mergedBlocked = manualDeployArchitectPolicyDecision({
  prUrl: "https://github.com/Taskix-AI/Taskix/pull/999",
  qaPassed: true,
  prState: "MERGED",
  prMerged: true
});

assert.equal(mergedBlocked.decision, "blocked");
assert.match(mergedBlocked.summary, /already merged/);

console.log("issue-run policy simulation passed");
