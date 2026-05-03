import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layoutSource = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
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
  globalStyles,
  /\.topbar-actions \.mantine-Badge-root\s*\{[^}]*flex:\s*0 0 auto;[^}]*max-width:\s*none;/s,
  "Header badges should keep their full width in the scrollable action row"
);

assert.match(
  globalStyles,
  /\.topbar-actions \.mantine-Badge-label\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/s,
  "Header badge labels should not ellipsize important control text"
);

console.log("header label verification passed");
