#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);
const serviceName = "ai.gitdex.next";
const systemdServiceName = "gitdex.service";

const commands = new Set(["help", "--help", "-h", "doctor", "dev", "start", "build", "update", "status", "install-service", "uninstall-service", "service-status", "service-logs"]);

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
  case "install-service":
    await installService(args);
    break;
  case "uninstall-service":
    await uninstallService();
    break;
  case "service-status":
    await serviceStatus();
    break;
  case "service-logs":
    serviceLogs(args);
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
  gitdex install-service [--no-build] [--no-start]
                   Install Gitdex as a launchd or user systemd service
  gitdex uninstall-service
                   Stop and remove the installed Gitdex service
  gitdex service-status
                   Show service manager status
  gitdex service-logs [--tail=N]
                   Print recent service logs
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
  const service = servicePaths();
  console.log(`Gitdex ${packageJson.version}`);
  console.log(`Root: ${rootDir}`);
  console.log(`Git: ${branch || "unknown"} ${commit || ""}`.trim());
  console.log(`Remote: ${remote || "unknown"}`);
  console.log(`DATA_DIR: ${process.env.DATA_DIR || path.join(rootDir, "data")}`);
  console.log(`127.0.0.1:8000: ${portFree ? "available" : "in use"}`);
  console.log(`Service: ${service.supported ? service.statusLabel : "unsupported on this platform"}`);
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
  const service = servicePaths();
  const rows = [
    ["Gitdex", packageJson.version ? `ok ${packageJson.version}` : "missing package metadata"],
    ...checks,
    ["gh auth", ghAuth[1]],
    ["port 8000", portFree ? "available" : "in use"],
    ["service", service.supported ? service.statusLabel : "missing unsupported platform"]
  ];
  for (const [name, result] of rows) {
    console.log(`${name.padEnd(10)} ${result}`);
  }
  if (rows.some(([, result]) => result.startsWith("missing"))) {
    process.exitCode = 1;
  }
}

async function installService(commandArgs) {
  const noBuild = commandArgs.includes("--no-build");
  const noStart = commandArgs.includes("--no-start");
  const service = servicePaths();
  if (!service.supported) {
    console.error("Service installation is supported on macOS launchd and Linux user systemd only.");
    process.exit(1);
  }
  if (!noBuild) {
    runChecked("npm", ["run", "build"]);
  }
  mkdirSync(path.dirname(service.file), { recursive: true });
  mkdirSync(service.logDir, { recursive: true });
  writeFileSync(service.file, service.content);
  if (service.platform === "darwin") {
    runOptional("launchctl", ["bootout", service.domain, service.file]);
    if (!noStart) {
      runChecked("launchctl", ["bootstrap", service.domain, service.file]);
      runChecked("launchctl", ["kickstart", "-k", `${service.domain}/${serviceName}`]);
    }
  } else {
    runChecked("systemctl", ["--user", "daemon-reload"]);
    runChecked("systemctl", ["--user", "enable", systemdServiceName]);
    if (!noStart) runChecked("systemctl", ["--user", "restart", systemdServiceName]);
  }
  console.log(`Installed Gitdex service: ${service.file}`);
}

async function uninstallService() {
  const service = servicePaths();
  if (!service.supported) {
    console.error("Service installation is supported on macOS launchd and Linux user systemd only.");
    process.exit(1);
  }
  if (service.platform === "darwin") {
    runOptional("launchctl", ["bootout", service.domain, service.file]);
  } else {
    runOptional("systemctl", ["--user", "disable", "--now", systemdServiceName]);
    runOptional("systemctl", ["--user", "daemon-reload"]);
  }
  if (existsSync(service.file)) unlinkSync(service.file);
  console.log(`Removed Gitdex service: ${service.file}`);
}

async function serviceStatus() {
  const service = servicePaths();
  if (!service.supported) {
    console.error("Service installation is supported on macOS launchd and Linux user systemd only.");
    process.exit(1);
  }
  if (service.platform === "darwin") {
    runChecked("launchctl", ["print", `${service.domain}/${serviceName}`]);
  } else {
    runChecked("systemctl", ["--user", "status", systemdServiceName]);
  }
}

function serviceLogs(commandArgs) {
  const service = servicePaths();
  const tailArg = commandArgs.find((arg) => arg.startsWith("--tail="));
  const tailCount = Number(tailArg?.slice("--tail=".length) || 80);
  const safeTailCount = Number.isFinite(tailCount) ? Math.max(1, Math.min(1000, Math.round(tailCount))) : 80;
  console.log(`stdout: ${service.stdoutLog}`);
  console.log(`stderr: ${service.stderrLog}`);
  printTail(service.stdoutLog, safeTailCount);
  printTail(service.stderrLog, safeTailCount);
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

function runOptional(bin, commandArgs) {
  spawnSync(bin, commandArgs, {
    cwd: rootDir,
    stdio: "ignore",
    env: process.env
  });
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

function servicePaths() {
  const platform = os.platform();
  const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
  const logDir = path.join(dataDir, "logs");
  const stdoutLog = path.join(logDir, "gitdex.out.log");
  const stderrLog = path.join(logDir, "gitdex.err.log");
  if (platform === "darwin") {
    const uid = typeof process.getuid === "function" ? process.getuid() : "";
    const domain = `gui/${uid}`;
    const file = path.join(os.homedir(), "Library", "LaunchAgents", `${serviceName}.plist`);
    return {
      supported: true,
      platform,
      domain,
      file,
      logDir,
      stdoutLog,
      stderrLog,
      statusLabel: existsSync(file) ? `launchd installed at ${file}` : "launchd not installed",
      content: launchdPlist({ stdoutLog, stderrLog, dataDir })
    };
  }
  if (platform === "linux") {
    const file = path.join(os.homedir(), ".config", "systemd", "user", systemdServiceName);
    return {
      supported: true,
      platform,
      file,
      logDir,
      stdoutLog,
      stderrLog,
      statusLabel: existsSync(file) ? `systemd installed at ${file}` : "systemd not installed",
      content: systemdUnit({ stdoutLog, stderrLog, dataDir })
    };
  }
  return {
    supported: false,
    platform,
    file: "",
    logDir,
    stdoutLog,
    stderrLog,
    statusLabel: "unsupported",
    content: ""
  };
}

function launchdPlist({ stdoutLog, stderrLog, dataDir }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${serviceName}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(rootDir)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(path.join(rootDir, "bin", "gitdex.mjs"))}</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DATA_DIR</key>
    <string>${escapeXml(dataDir)}</string>
    <key>PATH</key>
    <string>${escapeXml(process.env.PATH || "/usr/local/bin:/usr/bin:/bin")}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrLog)}</string>
</dict>
</plist>
`;
}

function systemdUnit({ stdoutLog, stderrLog, dataDir }) {
  return `[Unit]
Description=Gitdex Next.js service
After=network.target

[Service]
Type=simple
WorkingDirectory=${rootDir}
Environment=DATA_DIR=${dataDir}
ExecStart=${process.execPath} ${path.join(rootDir, "bin", "gitdex.mjs")} start
Restart=always
RestartSec=3
StandardOutput=append:${stdoutLog}
StandardError=append:${stderrLog}

[Install]
WantedBy=default.target
`;
}

function printTail(file, lines) {
  console.log(`\n==> ${file} <==`);
  if (!existsSync(file)) {
    console.log("No log file yet.");
    return;
  }
  const content = readFileSync(file, "utf8").trimEnd();
  const output = content.split("\n").slice(-lines).join("\n");
  console.log(output || "No log output.");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}
