import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { HEADER_LABEL } from "../src/components/header-label.ts";

assert.equal(HEADER_LABEL, "Gitdex Console");

const layoutSource = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

assert.match(layoutSource, /import \{ HEADER_LABEL \} from "@\/components\/header-label";/);
assert.match(layoutSource, /\{HEADER_LABEL\}/);

console.log("header label verification passed");
