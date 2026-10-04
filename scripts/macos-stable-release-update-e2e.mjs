#!/usr/bin/env node
/**
 * Prove stable GitHub release auto-updates on macOS CI, including a two-hop
 * path that leaves Squirrel's previous update.zip cache for blockmap deltas.
 *
 * Hop 1: install `from_tag` zip, updater → `via_version` (pinned release feed
 * when `to_version` is newer than `via_version`).
 * Hop 2 (optional): restart, updater → `to_version` via latest feed; may
 * require differential download (no full fallback, smaller than full zip).
 */

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
const GITHUB_REPO = process.env.GITHUB_REPOSITORY ?? "openma-ai/backchat";

export function parseFromTag(value) {
  const tag = value.trim();
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`from tag must be vX.Y.Z, got ${JSON.stringify(value)}`);
  }
  return tag;
}

export function parseToVersion(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new Error(`version must be x.y.z, got ${JSON.stringify(value)}`);
  }
  return trimmed;
}

export function parseRequireDifferential(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function releaseDownloadFeedUrl(tag) {
  const parsed = parseFromTag(tag);
  return `https://github.com/${GITHUB_REPO}/releases/download/${parsed}/`;
}

/** Parse stable e2e env / workflow inputs. */
export function parseStableUpdateConfig(env = process.env) {
  const fromTag = parseFromTag(env.BACKCHAT_STABLE_FROM_TAG ?? "v0.0.13");
  const viaVersion = parseToVersion(env.BACKCHAT_STABLE_VIA_VERSION ?? "");
  const toVersion = parseToVersion(env.BACKCHAT_STABLE_TO_VERSION ?? "");
  const requireDifferential = parseRequireDifferential(env.BACKCHAT_STABLE_REQUIRE_DIFFERENTIAL);
  const viaReleaseTagRaw = env.BACKCHAT_STABLE_VIA_RELEASE_TAG?.trim();
  const viaReleaseTag = viaReleaseTagRaw ? parseFromTag(viaReleaseTagRaw) : viaVersion ? `v${viaVersion}` : "";

  let hop1Target = viaVersion || toVersion;
  if (!hop1Target) {
    throw new Error("set BACKCHAT_STABLE_VIA_VERSION and/or BACKCHAT_STABLE_TO_VERSION");
  }

  const twoHop = Boolean(viaVersion && toVersion && viaVersion !== toVersion);
  const hop1FeedTag =
    twoHop && viaReleaseTag
      ? viaReleaseTag
      : "";

  return {
    fromTag,
    fromVersion: fromTag.slice(1),
    viaVersion,
    toVersion,
    hop1Target,
    twoHop,
    hop1FeedTag,
    hop1FeedUrl: hop1FeedTag ? releaseDownloadFeedUrl(hop1FeedTag) : "",
    requireDifferential: twoHop && requireDifferential,
  };
}

/** Inspect one updater log segment (not the combined transcript). */
export function analyzeUpdaterDownload(logText) {
  const text = logText ?? "";
  const fullFallback = /falling back to full download/i.test(text);
  const missingPrevious = /Unable to locate previous update\.zip/i.test(text);
  const blockMaps = /Download block maps|downloading block/i.test(text);
  let downloadedBytes = null;
  for (const match of text.matchAll(/transferred[^0-9]*(\d+)[^0-9]+(\d+)/gi)) {
    downloadedBytes = Math.max(downloadedBytes ?? 0, Number(match[1]));
  }
  for (const match of text.matchAll(/(\d+)\s*\/\s*(\d+)/g)) {
    const left = Number(match[1]);
    const right = Number(match[2]);
    if (right > 1_000_000 && left <= right) downloadedBytes = Math.max(downloadedBytes ?? 0, left);
  }
  return { fullFallback, missingPrevious, blockMaps, downloadedBytes };
}

export function assertDifferentialUpdate(logText, fullPackageBytes) {
  const analysis = analyzeUpdaterDownload(logText);
  const errors = [];
  if (analysis.fullFallback) errors.push("updater log contains falling back to full download");
  if (analysis.missingPrevious) errors.push("updater could not locate previous update.zip");
  if (!analysis.blockMaps) errors.push("updater log does not mention block map download");
  if (
    analysis.downloadedBytes != null
    && fullPackageBytes > 0
    && analysis.downloadedBytes >= fullPackageBytes * 0.9
  ) {
    errors.push(
      `downloaded bytes ${analysis.downloadedBytes} are not smaller than ~90% of full zip ${fullPackageBytes}`,
    );
  }
  return { errors, analysis };
}

export function squirrelCacheSummary() {
  const home = homedir();
  const roots = [
    join(home, "Library", "Caches", "dev.openma.backchat.ShipIt"),
    join(home, "Library", "Caches", "backchat-updater"),
  ];
  const hits = [];
  for (const root of roots) {
    try {
      walkCache(root, hits);
    } catch {
      // missing cache dir is ok before first update
    }
  }
  return hits;
}

function walkCache(dir, hits, depth = 0) {
  if (depth > 6) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCache(path, hits, depth + 1);
      continue;
    }
    if (/\.zip$/i.test(entry.name) || entry.name === "update.zip") {
      hits.push({ path, bytes: statSync(path).size });
    }
  }
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

function launchStable(appPath, logPath, feedUrl) {
  const binary = join(appPath, "Contents", "MacOS", "Backchat");
  mkdirSync(resolve(logPath, ".."), { recursive: true });
  writeFileSync(logPath, "");
  const handle = openSync(logPath, "a");
  const env = { ...process.env };
  env.BACKCHAT_UPDATE_E2E = "1";
  env.BACKCHAT_UPDATE_ACCEPT = "1";
  delete env.BACKCHAT_UPDATE_FEED_URL;
  if (feedUrl) env.BACKCHAT_UPDATE_FEED_URL = feedUrl;
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
  log(`launched pid=${child.pid} feed=${feedUrl ?? "GitHub latest stable"}`);
  return child.pid;
}

async function stopAllBackchat(socketPath) {
  const listing = spawnSync("pgrep", ["-x", "Backchat"], { encoding: "utf8" });
  for (const pid of (listing.stdout ?? "").split("\n").map((line) => Number(line.trim())).filter((n) => n > 0)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already exited
    }
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const alive = (spawnSync("pgrep", ["-x", "Backchat"], { encoding: "utf8" }).stdout ?? "").trim();
    if (!alive) break;
    await delay(200);
  }
  const still = (spawnSync("pgrep", ["-x", "Backchat"], { encoding: "utf8" }).stdout ?? "").trim();
  if (still) throw new Error(`Backchat still running: ${still}`);
  const socketDeadline = Date.now() + 15_000;
  while (await socketAlive(socketPath) && Date.now() < socketDeadline) await delay(200);
  if (await socketAlive(socketPath)) throw new Error("control socket stayed open after stopping Backchat");
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

function releaseMacZipSizeBytes(releaseTag) {
  const tag = parseFromTag(releaseTag);
  const result = spawnSync(
    "gh",
    ["api", `repos/${GITHUB_REPO}/releases/tags/${tag}`, "--jq", '.assets[] | select(.name | test("-mac\\\\.zip$")) | .size'],
    { encoding: "utf8", env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "" } },
  );
  if (result.status !== 0) throw new Error(`cannot read ${tag} mac zip size: ${result.stderr || result.stdout}`);
  const size = Number(String(result.stdout).trim().split("\n")[0]);
  if (!Number.isFinite(size) || size <= 0) throw new Error(`invalid mac zip size for ${tag}: ${result.stdout}`);
  return size;
}

async function waitForInstalledUpdate({
  installed,
  oldVersion,
  newVersion,
  oldPid,
  logPath,
  socketPath,
  deadlineMs = 20 * 60_000,
}) {
  const samples = [];
  let evidence = [];
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const sample = await sampleApp(installed, oldPid, socketPath);
    samples.push(sample);
    evidence = readEvidence();
    const proved = assertInstalledUpdate({
      oldVersion,
      newVersion,
      oldPid,
      evidence,
      samples,
      socketPath,
    }).length === 0;
    if (proved && bundleVersion(installed) === newVersion) {
      return { samples, evidence, logText: readFileSync(logPath, "utf8") };
    }
    await delay(500);
  }
  throw new Error(`timed out waiting for ${oldVersion} -> ${newVersion}; see ${logPath}`);
}

function assertSquirrelCachePresent(label) {
  const hits = squirrelCacheSummary();
  log(`${label} squirrel cache entries: ${hits.length}`);
  for (const hit of hits) log(`  ${hit.path} (${hit.bytes} bytes)`);
  writeFileSync(resolve("test-results/squirrel-cache-summary.json"), `${JSON.stringify(hits, null, 2)}\n`);
  if (hits.length === 0) {
    throw new Error(`${label}: no Squirrel/update zip cache found under ~/Library/Caches`);
  }
}

async function main() {
  if (process.platform !== "darwin") throw new Error("macos-stable-release-update-e2e runs on macOS");
  mkdirSync(resolve("test-results"), { recursive: true });
  writeFileSync(transcriptPath, "");

  const config = parseStableUpdateConfig();
  log(`config ${JSON.stringify(config)}`);

  const workDir = join(tmpdir(), "backchat-stable-update-src");
  const extractDir = join(tmpdir(), "backchat-stable-update-extract");
  rmSync(workDir, { recursive: true, force: true });
  rmSync(extractDir, { recursive: true, force: true });

  const zipPath = downloadReleaseZip(config.fromTag, workDir);
  log(`zip=${zipPath}`);
  mkdirSync(extractDir, { recursive: true });
  const unzip = run("/usr/bin/ditto", ["-x", "-k", zipPath, extractDir]);
  if (unzip.status !== 0) throw new Error(`ditto extract failed for ${zipPath}`);

  const sourceApp = findBackchatApp(extractDir);
  if (bundleVersion(sourceApp) !== config.fromVersion) {
    throw new Error(`expected ${config.fromVersion}, bundle has ${bundleVersion(sourceApp)}`);
  }
  requireDeveloperId(sourceApp);

  const installed = "/Applications/Backchat.app";
  const socketPath = join(homedir(), ".oma", "control.sock");
  placeApp(sourceApp, installed);

  const hop1Log = resolve("test-results/stable-release-hop1.log");
  rmSync(UPDATE_E2E_EVIDENCE_PATH, { force: true });
  const hop1Pid = launchStable(installed, hop1Log, config.hop1FeedUrl || undefined);
  const hop1 = await waitForInstalledUpdate({
    installed,
    oldVersion: config.fromVersion,
    newVersion: config.hop1Target,
    oldPid: hop1Pid,
    logPath: hop1Log,
    socketPath,
  });
  log(`hop1 complete version=${bundleVersion(installed)}`);
  writeFileSync(resolve("test-results/stable-release-hop1-updater.log"), hop1.logText);

  assertSquirrelCachePresent("after hop1");

  if (!config.twoHop) {
    log(`single-hop stable update ${config.fromVersion} -> ${config.hop1Target} succeeded`);
    writeFileSync(resolve("test-results/backchat-update-evidence.log"), readFileSync(UPDATE_E2E_EVIDENCE_PATH, "utf8"));
    return;
  }

  await stopAllBackchat(socketPath);
  const hop2FullZipBytes = releaseMacZipSizeBytes(`v${config.toVersion}`);
  log(`hop2 target zip full size=${hop2FullZipBytes} bytes (v${config.toVersion})`);

  rmSync(UPDATE_E2E_EVIDENCE_PATH, { force: true });
  const hop2Log = resolve("test-results/stable-release-hop2.log");
  const hop2Pid = launchStable(installed, hop2Log, undefined);
  const hop2 = await waitForInstalledUpdate({
    installed,
    oldVersion: config.hop1Target,
    newVersion: config.toVersion,
    oldPid: hop2Pid,
    logPath: hop2Log,
    socketPath,
  });
  writeFileSync(resolve("test-results/stable-release-hop2-updater.log"), hop2.logText);

  const diff = assertDifferentialUpdate(hop2.logText, hop2FullZipBytes);
  log(
    `hop2 download analysis: ${JSON.stringify({
      ...diff.analysis,
      fullPackageBytes: hop2FullZipBytes,
      ratio: diff.analysis.downloadedBytes == null
        ? null
        : diff.analysis.downloadedBytes / hop2FullZipBytes,
    })}`,
  );
  writeFileSync(
    resolve("test-results/stable-release-hop2-download.json"),
    `${JSON.stringify({ ...diff.analysis, fullPackageBytes: hop2FullZipBytes }, null, 2)}\n`,
  );

  if (config.requireDifferential && diff.errors.length) {
    throw new Error(diff.errors.join("\n"));
  }
  if (config.requireDifferential === false && diff.errors.length) {
    log(`hop2 differential warnings (require_differential=false): ${diff.errors.join("; ")}`);
  }

  writeFileSync(resolve("test-results/backchat-update-evidence.log"), readFileSync(UPDATE_E2E_EVIDENCE_PATH, "utf8"));
  log(`two-hop stable update ${config.fromVersion} -> ${config.hop1Target} -> ${config.toVersion} succeeded`);
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
