import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import packageJson from "../package.json" with { type: "json" };

const layoutSource = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  layoutSource,
  /packageJson|version=\{packageJson\.version\}|HeaderSecondaryActions/,
  "Root layout should not fetch package version only for the removed topbar"
);

assert.ok(packageJson.version, "package.json should define a version value");

console.log(`header removal version verification passed for ${packageJson.version}`);
