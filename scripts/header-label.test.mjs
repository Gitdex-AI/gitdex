import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layoutSource = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const headerActionsSource = await readFile(new URL("../src/components/HeaderSecondaryActions.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

assert.match(
  layoutSource,
  /<Text[^>]*className="topbar-title"[^>]*>\s*Gitdex\s*<\/Text>/,
  "Root layout header should visibly render the Gitdex brand name"
);

assert.match(
  layoutSource,
  /<Group[^>]*className="topbar-actions"[^>]*justify="flex-start"[^>]*wrap="nowrap"/,
  "Header actions should start-align inside the horizontal scroll region so overflow remains reachable"
);

assert.match(
  globalStyles,
  /\.topbar-actions\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto;/s,
  "Header actions should be allowed to shrink and scroll horizontally"
);

assert.match(
  headerActionsSource,
  /aria-label="Open console details and actions"/,
  "Compact header action menu should expose a clear accessible label"
);

assert.match(
  headerActionsSource,
  /Self-update v\$\{version\}/,
  "Compact header action menu should keep the self-update action label clear"
);

assert.match(
  globalStyles,
  /\.topbar-menu-trigger\s*\{[^}]*white-space:\s*nowrap;/s,
  "Compact header menu trigger should keep its action label readable"
);

console.log("header label verification passed");
