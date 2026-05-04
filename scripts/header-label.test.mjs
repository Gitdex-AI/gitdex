import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layoutSource = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

assert.doesNotMatch(
  layoutSource,
  /<header[^>]*className="topbar"/,
  "Root layout should not render the removed topbar header"
);

assert.doesNotMatch(
  layoutSource,
  /HeaderSecondaryActions|<Nav\b|topbar-title|topbar-actions/,
  "Root layout should not keep unused topbar header dependencies"
);

assert.doesNotMatch(
  globalStyles,
  /\.topbar\b|\.top-nav\b|topbar-menu/,
  "Global styles should not keep removed topbar or top navigation rules"
);

console.log("header removal verification passed");
