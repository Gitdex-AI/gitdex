import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { canAutoRunDeveloper, canAutoRunQa } from "../src/lib/auto-run-policy.ts";

const projectAutoRunnerSource = await readFile(new URL("../src/lib/project-auto-runner.ts", import.meta.url), "utf8");

const issue = (overrides = {}) => ({
  title: "Issue",
  description: "Issue",
  assigneeRole: "developer",
  acceptanceCriteria: [],
  issueId: "issue-1",
  githubState: "OPEN",
  prState: "OPEN",
  prUrl: "https://github.com/Gitdex-AI/gitdex/pull/1",
  labels: [],
  prLabels: [],
  ...overrides
});

describe("canAutoRunQa", () => {
  it("allows QA-stage issues to start QA", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["gd:qa"] })), true);
  });

  it("does not start QA while QA is already running", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["gd:blocked"] })), false);
  });

  it("does not start QA for closed PRs", () => {
    assert.equal(canAutoRunQa(issue({ prState: "CLOSED" })), false);
  });

  it("does not restart QA for environment-blocked issues", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["gd:blocked"] })), false);
  });

  it("does not start QA for PRs returned for rebase", () => {
    assert.equal(canAutoRunQa(issue({ labels: ["gd:rebase"] })), false);
  });
});

describe("canAutoRunDeveloper", () => {
  it("allows open dev-stage issues without a PR", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:dev"] })), true);
  });

  it("does not start developer work for blocked issues", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:blocked"] })), false);
  });

  it("does not start developer work for spec-blocked issues", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:architect"] })), false);
  });

  it("does not start developer work for environment-blocked issues", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:blocked"] })), false);
  });

  it("does not treat rebase-required PRs as fresh developer work", () => {
    assert.equal(canAutoRunDeveloper(issue({ prUrl: null, prState: null, labels: ["gd:rebase"] })), false);
  });
});

describe("stale failed return jobs", () => {
  it("ignores failed review or merge jobs once a newer developer retry succeeded", () => {
    assert.match(
      projectAutoRunnerSource,
      /if \(latest && hasSuccessfulDeveloperJobAfter\(issue, workflow, jobs, Date\.parse\(latest\.updatedAt\)\)\) return false;/
    );
    assert.match(projectAutoRunnerSource, /job\.type === "issue_run"[\s\S]*job\.status === "done"[\s\S]*Date\.parse\(job\.updatedAt\) > timestamp/);
  });
});
