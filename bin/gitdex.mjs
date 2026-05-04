#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);

const commands = new Set(["help", "--help", "-h", "doctor", "dev", "start", "build", "update", "status"]);

if (!commands.has(command)) {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

switch (command) {
  case "doctor":
    await doctor();
    break;
  case "dev":
    await runNpmScript("dev", args);
    break;
  case "start":
    await runNpmScript("start", args);
    break;
  case "build":
    await runNpmScript("build", args);
    break;
  case "update":
    await update();
    break;
  case "status":
    await status();
    break;
  default:
    printHelp();
}

function printHelp() {
  console.log(`Gitdex CLI

Usage:
  gitdex dev       Start the local development server on 127.0.0.1:8000
  gitdex start     Start the production Next.js server on 127.0.0.1:8000
  gitdex build     Build the production app
  gitdex update    Pull latest code, install dependencies, and build
  gitdex doctor    Check local prerequisites
  gitdex status    Show local app and repository status
`);
}

async function update() {
  runChecked("git", ["pull"]);
  runChecked("npm", ["install"]);
  runChecked("npm", ["run", "build"]);
  console.log("Gitdex update completed. Restart the running service or dev server.");
}

async function status() {
  const packageJson = readPackageMetadata();
  const branch = readCommand("git", ["branch", "--show-current"]);
  const commit = readCommand("git", ["rev-parse", "--short", "HEAD"]);
  const remote = readCommand("git", ["remote", "get-url", "origin"]);
  const portFree = await canBindPort(8000);
  console.log(`Gitdex ${packageJson.version}`);
  console.log(`Root: ${rootDir}`);
  console.log(`Git: ${branch || "unknown"} ${commit || ""}`.trim());
  console.log(`Remote: ${remote || "unknown"}`);
  console.log(`DATA_DIR: ${process.env.DATA_DIR || path.join(rootDir, "data")}`);
  console.log(`127.0.0.1:8000: ${portFree ? "available" : "in use"}`);
}

async function doctor() {
  const checks = [
    checkCommand("node", ["--version"]),
    checkCommand("npm", ["--version"]),
    checkCommand("git", ["--version"]),
    checkCommand("gh", ["--version"]),
    checkCommand("codex", ["--version"])
  ];
  const ghAuth = checkCommand("gh", ["auth", "status"]);
  const packageJson = readPackageMetadata();
  const portFree = await canBindPort(8000);
  const rows = [
    ["Gitdex", packageJson.version ? `ok ${packageJson.version}` : "missing package metadata"],
    ...checks,
    ["gh auth", ghAuth[1]],
    ["port 8000", portFree ? "available" : "in use"]
  ];
  for (const [name, result] of rows) {
    console.log(`${name.padEnd(10)} ${result}`);
  }
  if (rows.some(([, result]) => result.startsWith("missing"))) {
    process.exitCode = 1;
  }
}

async function runNpmScript(script, extraArgs) {
  const npmArgs = ["run", script, ...(extraArgs.length ? ["--", ...extraArgs] : [])];
  await runInteractive("npm", npmArgs);
}

function runChecked(bin, commandArgs) {
  const result = spawnSync(bin, commandArgs, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runInteractive(bin, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(bin, commandArgs, {
      cwd: rootDir,
      stdio: "inherit",
      env: process.env
    });
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

function checkCommand(bin, commandArgs) {
  const result = spawnSync(bin, commandArgs, {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env
  });
  if (result.status === 0) {
    const output = `${result.stdout}${result.stderr}`.trim().split("\n")[0] ?? "ok";
    return [bin, `ok ${output}`];
  }
  const detail = result.error?.code === "ENOENT" ? "not found" : `${result.stderr || result.error?.message || "failed"}`.trim();
  return [bin, `missing ${detail}`];
}

function readCommand(bin, commandArgs) {
  const result = spawnSync(bin, commandArgs, {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function readPackageMetadata() {
  try {
    return JSON.parse(readCommand("node", ["-e", "process.stdout.write(JSON.stringify(require('./package.json')))"]));
  } catch {
    return {};
  }
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}
