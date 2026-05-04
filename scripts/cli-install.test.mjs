import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const cliSource = readFileSync("bin/gitdex.mjs", "utf8");
const installSource = readFileSync("scripts/install.sh", "utf8");

test("package exposes the gitdex CLI bin", () => {
  assert.equal(packageJson.bin?.gitdex, "./bin/gitdex.mjs");
  assert.match(cliSource, /^#!\/usr\/bin\/env node/);
});

test("gitdex CLI exposes install-facing commands", () => {
  for (const command of ["doctor", "dev", "start", "build", "update", "status"]) {
    assert.match(cliSource, new RegExp(`gitdex ${command}`));
  }
  assert.match(cliSource, /runNpmScript\("dev"/);
  assert.match(cliSource, /runNpmScript\("start"/);
  assert.match(cliSource, /runChecked\("git", \["pull"\]\)/);
});

test("install script installs from GitHub and links the local CLI", () => {
  assert.match(installSource, /GITDEX_REPO_URL:-https:\/\/github\.com\/Gitdex-AI\/gitdex\.git/);
  assert.match(installSource, /npm install/);
  assert.match(installSource, /npm run build/);
  assert.match(installSource, /ln -sf "\$install_dir\/bin\/gitdex\.mjs" "\$bin_dir\/gitdex"/);
});
