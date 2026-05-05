import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const cliSource = readFileSync("bin/gitdex.mjs", "utf8");
const installSource = readFileSync("scripts/install.sh", "utf8");
const pagesInstallSource = readFileSync("docs/install.sh", "utf8");
const landingSource = readFileSync("docs/index.html", "utf8");

test("package exposes the gitdex CLI bin", () => {
  assert.equal(packageJson.bin?.gitdex, "./bin/gitdex.mjs");
  assert.match(cliSource, /^#!\/usr\/bin\/env node/);
});

test("gitdex CLI exposes install-facing commands", () => {
  for (const command of ["doctor", "dev", "start", "build", "update", "status", "install-service", "uninstall-service", "service-status", "service-logs"]) {
    assert.match(cliSource, new RegExp(`gitdex ${command}`));
  }
  assert.match(cliSource, /runNpmScript\("dev"/);
  assert.match(cliSource, /runNpmScript\("start"/);
  assert.match(cliSource, /runChecked\("git", \["pull"\]\)/);
});

test("gitdex CLI can install macOS launchd and Linux user systemd services", () => {
  assert.match(cliSource, /Library", "LaunchAgents", `\$\{serviceName\}\.plist`/);
  assert.match(cliSource, /launchctl", \["bootstrap", service\.domain, service\.file\]/);
  assert.match(cliSource, /if \(!noStart\) \{\n      runChecked\("launchctl", \["bootstrap", service\.domain, service\.file\]\)/);
  assert.match(cliSource, /\.config", "systemd", "user", systemdServiceName/);
  assert.match(cliSource, /systemctl", \["--user", "enable", systemdServiceName\]/);
  assert.match(cliSource, /service-logs \[--tail=N\]/);
});

test("install script installs from GitHub and links the local CLI", () => {
  assert.match(installSource, /GITDEX_REPO_URL:-https:\/\/github\.com\/Gitdex-AI\/gitdex\.git/);
  assert.match(installSource, /GITDEX_REF:-v0\.2\.0/);
  assert.match(installSource, /git clone --branch "\$ref"/);
  assert.match(installSource, /git -C "\$install_dir" checkout "\$ref"/);
  assert.match(installSource, /npm install/);
  assert.match(installSource, /npm run build/);
  assert.match(installSource, /ln -sf "\$install_dir\/bin\/gitdex\.mjs" "\$bin_dir\/gitdex"/);
  assert.match(installSource, /GITDEX_INSTALL_SERVICE:-0/);
  assert.match(installSource, /install-service --no-build/);
});

test("GitHub Pages publishes the stable installer under gitdex.ai", () => {
  assert.equal(pagesInstallSource, installSource);
  assert.match(landingSource, /https:\/\/gitdex\.ai\/install\.sh/);
});
