import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import packageJson from "../package.json" with { type: "json" };

const layoutSource = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

assert.match(
  layoutSource,
  /import packageJson from "\.\.\/\.\.\/package\.json";/,
  "Root layout should source the header version from package.json"
);

assert.match(
  layoutSource,
  /<HeaderSecondaryActions[^>]*projects=\{headerProjects\}[^>]*version=\{packageJson\.version\}[^>]*\/>/,
  "Root layout should wire the package version into the compact header actions entry point"
);

assert.match(
  layoutSource,
  /version=\{packageJson\.version\}/,
  "Root layout should pass the package version without duplicating the version literal"
);

assert.ok(packageJson.version, "package.json should define a version value");

console.log(`header version verification passed for ${packageJson.version}`);
