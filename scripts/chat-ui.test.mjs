import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const projectPageSource = await readFile(new URL("../src/app/projects/[projectId]/page.tsx", import.meta.url), "utf8");
const chatAreaSource = await readFile(new URL("../src/components/ProjectChatArea.tsx", import.meta.url), "utf8");
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

assert.match(
  projectPageSource,
  /const visibleWorkflows = sortedWorkflows\.filter\(\(workflow\) => !workflow\.archivedAt\);[\s\S]*const latestWorkflow = queuedWorkflow \?\? visibleActiveWorkflows\[0\] \?\? visibleWorkflows\[0\] \?\? null;/,
  "Archived requirements should be hidden from the default sidebar workflow selection"
);

console.log("chat UI source verification passed");
