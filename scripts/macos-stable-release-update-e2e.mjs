#!/usr/bin/env node
/**
 * Prove a signed stable release in /Applications updates through GitHub
 * `releases/latest/download` + `latest-mac.yml` (real v0.0.13 → v0.0.14).
 *
 * Runs only on macOS CI. Uses BACKCHAT_UPDATE_E2E hooks; does not publish.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  UPDATE_E2E_EVIDENCE_PATH,
  assertInstalledUpdate,
} from "./macos-update-e2e.mjs";

const transcriptPath = resolve("test-results/macos-stable-release-update-e2e.txt");

export function parseFromTag(value) {
  const tag = value.trim();
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`from tag must be vX.Y.Z, got ${JSON.stringify(value)}`);
  }
  return tag;
}

export function parseToVersion(value) {
  const version = value.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`target version must be x.y.z, got ${JSON.stringify(value)}`);
  }
  return version;
}

/** Best-effort signal from electron-updater logger lines captured in app stdout. */
export function updaterDownloadMode(logText) {
  const text = logText.toLowerCase();
  if (/blockmap|differential download|download block|downloading block/i.test(text)) {
    return "differential";
  }
  if (/full download|disable differential|cannot download differentially|fallback to full/i.test(text)) {
    return "full";
  }
  return "unknown";
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  appendFileSync(transcriptPath, line);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
  log(`$ ${command} ${args.join(" ")}`);
  if (output) log(output);
  log(`exit:${result.status ?? "null"}`);
  return result;
}

function bundleVersion(appPath) {
  const plist = join(appPath, "Contents", "Info.plist");
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || `cannot read ${plist}`);
  return result.stdout.trim();
}

function readEvidence() {
  try {
    return readFileSync(UPDATE_E2E_EVIDENCE_PATH, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function relaunchedPid(oldPid) {
  const result = spawnSync("pgrep", ["-x", "Backchat"], { encoding: "utf8" });
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => Number(line.trim()))
    .find((pid) => pid > 0 && pid !== oldPid) ?? 0;
}

async function socketAlive(socketPath) {
  const { createConnection } = await import("node:net");
  return new Promise((resolvePromise) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(value);
    };
    const timer = setTimeout(() => finish(false), 500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function tryBundleVersion(appPath) {
  try {
    return bundleVersion(appPath);
  } catch {
    return "";
  }
}

async function sampleApp(appPath, pid, socketPath) {
  return {
    t: new Date().toISOString(),
    oldPidAlive: pidAlive(pid),
    newPid: relaunchedPid(pid),
    socketExists: await socketAlive(socketPath),
    version: tryBundleVersion(appPath),
  };
}

function requireDeveloperId(appPath) {
  const verify = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  const details = run("/usr/bin/codesign", ["-dvvv", appPath]);
  const gatekeeper = run("/usr/sbin/spctl", ["-a", "-vv", appPath]);
  const staple = run("xcrun", ["stapler", "validate", appPath]);
  const described = `${details.stderr ?? ""}\n${details.stdout ?? ""}`;
  if (verify.status !== 0 || gatekeeper.status !== 0 || staple.status !== 0) {
    throw new Error(`${appPath} is not a stapled Developer ID app`);
  }
  if (!described.includes("Developer ID Application")) {
    throw new Error(`${appPath} is not signed with Developer ID Application`);
  }
  if (!described.includes("Notarization Ticket=stapled")) {
    throw new Error(`${appPath} has no stapled notarization ticket`);
  }
}

function removeApp(dest) {
  try {
    rmSync(dest, { recursive: true, force: true });
  } catch {
    const result = run("sudo", ["rm", "-rf", dest]);
    if (result.status !== 0) throw new Error(`cannot remove ${dest}`);
  }
}

function placeApp(source, dest) {
  removeApp(dest);
  mkdirSync(resolve(dest, ".."), { recursive: true });
  let result = run("/usr/bin/ditto", [source, dest]);
  if (result.status !== 0) {
    result = run("sudo", ["/usr/bin/ditto", source, dest]);
    const user = spawnSync("id", ["-un"], { encoding: "utf8" }).stdout.trim();
    run("sudo", ["chown", "-R", `${user}:staff`, dest]);
  }
  if (result.status !== 0) throw new Error(`cannot install ${dest}`);
  run("xattr", ["-dr", "com.apple.quarantine", dest]);
}

function launchStable(appPath, logPath) {
  const binary = join(appPath, "Contents", "MacOS", "Backchat");
  mkdirSync(resolve(logPath, ".."), { recursive: true });
  const handle = openSync(logPath, "a");
  const env = { ...process.env };
  env.BACKCHAT_UPDATE_E2E = "1";
  env.BACKCHAT_UPDATE_ACCEPT = "1";
  delete env.BACKCHAT_UPDATE_FEED_URL;
  delete env.BACKCHAT_TEST_HOOKS;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, [], {
    env,
    detached: true,
    stdio: ["ignore", handle, handle],
  });
  closeSync(handle);
  child.unref();
  if (!child.pid) throw new Error(`failed to launch ${binary}`);
  log(`launched pid=${child.pid} stable feed (GitHub latest)`);
  return child.pid;
}

function findBackchatApp(root) {
  const result = spawnSync("find", [root, "-type", "d", "-name", "Backchat.app"], { encoding: "utf8" });
  const apps = (result.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (apps.length !== 1) throw new Error(`expected one Backchat.app under ${root}, found ${apps.join(", ") || "(none)"}`);
  return apps[0];
}

function downloadReleaseZip(fromTag, workDir) {
  mkdirSync(workDir, { recursive: true });
  const dl = run("gh", ["release", "download", fromTag, "-p", "Backchat-*-mac.zip", "-D", workDir], {
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "" },
  });
  if (dl.status !== 0) throw new Error(`gh release download ${fromTag} failed`);
  const zipList = spawnSync("find", [workDir, "-name", "Backchat-*-mac.zip", "-type", "f"], { encoding: "utf8" });
  const zips = (zipList.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (zips.length !== 1) throw new Error(`expected one zip in ${workDir}, found ${zips.join(", ") || "(none)"}`);
  return zips[0];
}

async function main() {
  if (process.platform !== "darwin") throw new Error("macos-stable-release-update-e2e runs on macOS");
  mkdirSync(resolve("test-results"), { recursive: true });
  writeFileSync(transcriptPath, "");

  const fromTag = parseFromTag(process.env.BACKCHAT_STABLE_FROM_TAG ?? process.argv[2] ?? "v0.0.13");
  const toVersion = parseToVersion(process.env.BACKCHAT_STABLE_TO_VERSION ?? process.argv[3] ?? "0.0.14");
  const fromVersion = fromTag.slice(1);

  const workDir = join(tmpdir(), "backchat-stable-update-src");
  const extractDir = join(tmpdir(), "backchat-stable-update-extract");
  rmSync(workDir, { recursive: true, force: true });
  rmSync(extractDir, { recursive: true, force: true });

  const zipPath = downloadReleaseZip(fromTag, workDir);
  log(`zip=${zipPath}`);
  mkdirSync(extractDir, { recursive: true });
  const unzip = run("/usr/bin/ditto", ["-x", "-k", zipPath, extractDir]);
  if (unzip.status !== 0) throw new Error(`ditto extract failed for ${zipPath}`);

  const sourceApp = findBackchatApp(extractDir);
  const oldVersion = bundleVersion(sourceApp);
  if (oldVersion !== fromVersion) {
    throw new Error(`expected ${fromVersion} from ${fromTag}, bundle has ${oldVersion}`);
  }
  log(`source app ${sourceApp} version=${oldVersion}`);
  requireDeveloperId(sourceApp);

  const installed = "/Applications/Backchat.app";
  const socketPath = join(homedir(), ".oma", "control.sock");
  placeApp(sourceApp, installed);
  if (bundleVersion(installed) !== oldVersion) throw new Error("/Applications version mismatch after install");

  rmSync(UPDATE_E2E_EVIDENCE_PATH, { force: true });
  const installedLog = resolve("test-results/stable-release-installed-app.log");
  const installedPid = launchStable(installed, installedLog);

  const installedSamples = [];
  let installedEvidence = [];
  const installDeadline = Date.now() + 20 * 60_000;
  while (Date.now() < installDeadline) {
    const sample = await sampleApp(installed, installedPid, socketPath);
    installedSamples.push(sample);
    installedEvidence = readEvidence();
    const proved = assertInstalledUpdate({
      oldVersion,
      newVersion: toVersion,
      oldPid: installedPid,
      evidence: installedEvidence,
      samples: installedSamples,
      socketPath,
    }).length === 0;
    if (proved && bundleVersion(installed) === toVersion) break;
    await delay(500);
  }

  const finalVersion = tryBundleVersion(installed);
  log(`CFBundleShortVersionString=${finalVersion}`);
  const installErrors = assertInstalledUpdate({
    oldVersion,
    newVersion: toVersion,
    oldPid: installedPid,
    evidence: installedEvidence,
    samples: installedSamples,
    socketPath,
  });
  if (installErrors.length) throw new Error(installErrors.join("\n"));
  if (finalVersion !== toVersion) {
    throw new Error(`expected version ${toVersion} after update, got ${finalVersion}`);
  }

  let logText = "";
  try {
    logText = readFileSync(installedLog, "utf8");
  } catch {
    logText = "";
  }
  const mode = updaterDownloadMode(logText);
  log(`updater download mode (heuristic): ${mode}`);
  writeFileSync(resolve("test-results/stable-release-updater.log"), logText);
  writeFileSync(resolve("test-results/backchat-update-evidence.log"), readFileSync(UPDATE_E2E_EVIDENCE_PATH, "utf8"));
  log(`stable release update ${fromVersion} -> ${toVersion} succeeded`);
  if (mode === "unknown") {
    log("warning: could not classify updater log as differential or full; see stable-release-updater.log");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    try {
      log(message);
    } catch {
      console.error(message);
    }
    process.exitCode = 1;
  });
}
