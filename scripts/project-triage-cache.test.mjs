import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const triagePageSource = await readFile(new URL("../src/app/projects/[projectId]/github-triage/page.tsx", import.meta.url), "utf8");
const triagePanelSource = await readFile(new URL("../src/components/ProjectGitHubTriagePanel.tsx", import.meta.url), "utf8");
const triageApiSource = await readFile(new URL("../src/app/api/projects/[projectId]/triage/route.ts", import.meta.url), "utf8");
const refreshButtonSource = await readFile(new URL("../src/components/ProjectGitHubTriageRefreshButton.tsx", import.meta.url), "utf8");
const githubLocalSource = await readFile(new URL("../src/lib/github-local.ts", import.meta.url), "utf8");
const projectTriageSource = await readFile(new URL("../src/lib/project-triage.ts", import.meta.url), "utf8");

test("GitHub triage page and API read local workflow cache instead of live gh", () => {
  assert.match(triagePageSource, /ProjectGitHubTriagePanel/);
  assert.match(triagePanelSource, /getProjectTriageFromWorkflows/);
  assert.match(triageApiSource, /getProjectTriageFromWorkflows/);
  assert.doesNotMatch(triagePanelSource, /getProjectTriageWithGh/);
  assert.doesNotMatch(triageApiSource, /getProjectTriageWithGh/);
});

test("GitHub triage refresh explicitly syncs before refreshing the cached view", () => {
  assert.match(refreshButtonSource, /fetch\(`\/api\/projects\/\$\{projectId\}\/sync`, \{ method: "POST" \}\)/);
  assert.match(refreshButtonSource, />\s*Sync\s*<\/Button>/);
});

test("live GitHub triage helper batches issue and PR reads", () => {
  const helperStart = githubLocalSource.indexOf("export async function getProjectTriageWithGh");
  const helperEnd = githubLocalSource.indexOf("\nfunction getTriageItemFromLinkedPullRequests", helperStart);
  const helperBody = githubLocalSource.slice(helperStart, helperEnd);

  assert.match(helperBody, /Promise\.all/);
  assert.match(helperBody, /"issue"[\s\S]*"list"/);
  assert.match(helperBody, /"pr"[\s\S]*"list"/);
  assert.doesNotMatch(helperBody, /issues\.map\(\(issue\) => getTriageItemWithGh/);
});

test("local triage derives cached issue and PR state from workflow records", () => {
  assert.match(projectTriageSource, /export function getProjectTriageFromWorkflows/);
  assert.match(projectTriageSource, /workflow\.issues\.map\(\(issue\) => triageItemFromIssue\(issue\)\)/);
  assert.match(projectTriageSource, /issue\.prUrl \?\? null/);
  assert.match(projectTriageSource, /issue\.prState \?\? null/);
  assert.match(projectTriageSource, /classifyTriageIssue\(\{/);
  assert.match(projectTriageSource, /lastSyncedAt: latestGitHubSyncAt\(input\.workflows\)/);
});

test("local triage reports the latest cached GitHub sync timestamp", () => {
  assert.match(projectTriageSource, /GitHub sync \(\?:checked\|completed\|ran\|synced\)/);
  assert.match(projectTriageSource, /Synced GitHub issue\\\/PR labels at/);
  assert.match(projectTriageSource, /new Date\(Math\.max\(\.\.\.timestamps\)\)\.toISOString\(\)/);
});
