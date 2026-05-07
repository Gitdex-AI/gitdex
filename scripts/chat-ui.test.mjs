import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const projectPageSource = await readFile(new URL("../src/app/projects/[projectId]/page.tsx", import.meta.url), "utf8");
const chatAreaSource = await readFile(new URL("../src/components/ProjectChatArea.tsx", import.meta.url), "utf8");
const autoRunButtonSource = await readFile(new URL("../src/components/ProjectAutoRunIssuesButton.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

assert.doesNotMatch(
  projectPageSource,
  /className="chat-header"/,
  "Project page should not render the duplicated chat-card header above the timeline"
);

assert.doesNotMatch(
  globalStyles,
  /\.chat-header\b/,
  "Global styles should not reserve space for the removed chat header"
);

assert.match(
  chatAreaSource,
  /readOnly\s*\?\s*\([\s\S]*className="chat-session-status"[\s\S]*Read-only session/,
  "Read-only session inspection should still render a visible status near the chat area"
);

assert.match(
  chatAreaSource,
  /!\s*readOnly\s*&&\s*\([\s\S]*className="chat-composer"/,
  "Normal chat mode should keep the composer available"
);

assert.match(
  chatAreaSource,
  /Default target\s*<Code>PM<\/Code>/,
  "Normal chat composer should keep the default PM target indicator"
);

assert.match(
  projectPageSource,
  /if\s*\(isCompletedIssue\(input\.issue\)\)\s*return\s+null;[\s\S]*if\s*\(input\.canRunDev\)/,
  "Completed or merged issues should not fall through to the completed-developer-job Run Dev fallback"
);

assert.doesNotMatch(
  projectPageSource,
  /shouldFailedJobReturnToDeveloper/,
  "Failed review or merge jobs should not override the current GitHub stage into Run Dev"
);

assert.match(
  projectPageSource,
  /if \(input\.canMerge\)[\s\S]*if \(input\.activeJob\?\.status === "failed"\)/,
  "Merge-stage issues with a stale failed merge job should still expose the stage-correct Run Merge action"
);

assert.match(
  projectPageSource,
  /const visibleWorkflows = sortedWorkflows\.filter\(\(workflow\) => !workflow\.archivedAt\);[\s\S]*const latestWorkflow = queuedWorkflow \?\? visibleActiveWorkflows\[0\] \?\? visibleWorkflows\[0\] \?\? null;/,
  "Archived requirements should be hidden from the default sidebar workflow selection"
);

assert.match(
  chatAreaSource,
  /if \(job\) return job\.status === "running" && !job\.runtime\?\.agentFinalAt;/,
  "Stale running messages linked to failed or completed jobs should not keep showing live timers"
);

assert.match(
  chatAreaSource,
  /if \(job && job\.status !== "running"\) return stripAgentFinalBlocks\(message\.content\);/,
  "Stale running messages linked to terminal jobs should render as static text without elapsed time"
);

assert.match(
  autoRunButtonSource,
  /const runningStatuses = new Set<AutoRunStatus>\(\["running", "cancel_requested"\]\);/,
  "Pause-requested Auto Run state should not keep the primary Auto Run button spinning"
);

assert.match(
  autoRunButtonSource,
  /const paused = state\?\.status === "paused" \|\| state\?\.status === "pause_requested";/,
  "Pause-requested Auto Run state should be resumable from the primary button"
);

assert.match(
  autoRunButtonSource,
  /fetch\(paused \? `\/api\/projects\/\$\{projectId\}\/issues\/auto-run\/control` : `\/api\/projects\/\$\{projectId\}\/issues\/auto-run`/,
  "Resume should use the Auto Run control route instead of trying to start a duplicate run"
);

assert.match(
  projectPageSource,
  /\["running", "cancel_requested"\]\.includes\(state\.status\)/,
  "Issue-level pending jobs should not render as active spinners while Auto Run is only pause-requested"
);

assert.match(
  projectPageSource,
  /const hasRunnableIssues = workflow\.status !== "done" && workflow\.issues\.some\(\(issue\) => !isCompletedIssue\(issue\)\);/,
  "Completed requirements should not show Auto Run just because they still contain historical issues"
);

assert.match(
  projectPageSource,
  /active && !planningAction && hasRunnableIssues/,
  "Requirement Auto Run should only render when the active requirement still has runnable issues"
);

assert.match(
  projectPageSource,
  /const activeIssueId = query\.issue \?\? null;/,
  "Project workspace should support issue-scoped chat timeline selection"
);

assert.match(
  projectPageSource,
  /filterSessionsForIssue\(sessions, workflowPanelWorkflows, activeIssueId\)/,
  "Issue-scoped chat timeline should filter sessions to the selected issue"
);

assert.match(
  projectPageSource,
  /filterJobsForIssue\(jobs, workflowPanelWorkflows, activeIssueId\)/,
  "Issue-scoped chat timeline should filter jobs to the selected issue"
);

assert.match(
  projectPageSource,
  /href=\{`\/projects\/\$\{projectId\}\?workflow=\$\{encodeURIComponent\(workflow\.workflowId\)\}&issue=\$\{encodeURIComponent\(issue\.issueId\)\}&phase=github`\}/,
  "Issue numbers in the sidebar should link to the issue-scoped timeline"
);

assert.match(
  globalStyles,
  /\.github-issue-number-link\b/,
  "Issue number timeline links should have explicit link styling"
);

console.log("chat UI source verification passed");
