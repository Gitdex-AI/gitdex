import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";

process.chdir(mkdtempSync(`${tmpdir()}/gitdex-issue-run-policy-`));

import {
  expectedDeveloperBranch,
  expectedDeveloperBaseBranch,
  isRecoverablePrBase,
  manualDeployArchitectPolicyDecision,
  manualDeployFinalLabelPlan,
  prRecoveryBranches
} from "../src/lib/issue-run-policy.ts";

const workflowCode = "WF-20260501-999";
const issueNumber = 123;
const expectedBranch = `gitdex/${workflowCode}-issue-${issueNumber}`;

assert.equal(expectedDeveloperBranch(workflowCode, issueNumber), expectedBranch);
assert.equal(expectedDeveloperBaseBranch(), "main");
assert.equal(isRecoverablePrBase("main"), true);
assert.equal(isRecoverablePrBase("issue-86-wider-workflow-rail"), false);
assert.equal(isRecoverablePrBase(null), false);

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
  prUrl: "https://github.com/Gitdex-AI/gitdex/pull/999",
  architectDecision: manualDeployArchitectPolicyDecision({
    prUrl: "https://github.com/Gitdex-AI/gitdex/pull/999",
    qaPassed: true,
    prState: "OPEN",
    prMerged: false
  })
});

assert.equal(ready.decision, "ready_to_merge");
assert.deepEqual(ready.labelsApplied, ["gd:merge"]);
assert.deepEqual(ready.labelsRemoved, ["gd:qa", "gd:review", "gd:blocked"]);
assert.match(ready.summary, /ready for the dedicated merge step/);
assert.match(ready.summary, /does not block merging/);

const blocked = manualDeployFinalLabelPlan({
  prUrl: "https://github.com/Gitdex-AI/gitdex/pull/999",
  architectDecision: manualDeployArchitectPolicyDecision({
    prUrl: "https://github.com/Gitdex-AI/gitdex/pull/999",
    qaPassed: false,
    prState: "OPEN",
    prMerged: false
  })
});

assert.equal(blocked.decision, "blocked");
assert.deepEqual(blocked.labelsApplied, ["gd:fix"]);
assert.deepEqual(blocked.labelsRemoved, ["gd:review", "gd:merge"]);
assert.match(blocked.summary, /QA has not passed/);

const rebase = manualDeployFinalLabelPlan({
  prUrl: "https://github.com/Gitdex-AI/gitdex/pull/999",
  architectDecision: {
    decision: "needs_developer_rebase",
    summary: "PR has merge conflicts against main.",
    labelsApplied: [],
    comments: ["Resolve conflicts on the PR branch."]
  }
});

assert.equal(rebase.decision, "needs_developer_rebase");
assert.deepEqual(rebase.labelsApplied, ["gd:rebase"]);
assert.deepEqual(rebase.labelsRemoved, ["gd:review", "gd:merge"]);
assert.match(rebase.summary, /merge conflicts/);

const mergedBlocked = manualDeployArchitectPolicyDecision({
  prUrl: "https://github.com/Gitdex-AI/gitdex/pull/999",
  qaPassed: true,
  prState: "MERGED",
  prMerged: true
});

assert.equal(mergedBlocked.decision, "blocked");
assert.match(mergedBlocked.summary, /already merged/);

console.log("issue-run policy simulation passed");
