import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layoutSource = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

assert.match(
  layoutSource,
  /<Text[^>]*>\s*Gitdex Management\s*<\/Text>/,
  "Root layout header should visibly render Gitdex Management"
);

console.log("header label verification passed");
