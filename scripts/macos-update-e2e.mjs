#!/usr/bin/env node
/**
 * Prove a Developer ID preview build in /Applications replaces itself with
 * the next preview build, and that a copy anywhere else does not.
 *
 * The feed URL and the accept flag are process env for this run. They are
 * not settings.
 */

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, createReadStream, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const UPDATE_E2E_EVIDENCE_PATH = "/tmp/backchat-update-evidence.log";
export const OLD_PREVIEW_BUILD = 910001;
export const NEW_PREVIEW_BUILD = 910002;

const transcriptPath = resolve("test-results/macos-update-e2e.txt");

export function previewVersion(baseVersion, build) {
  if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
    throw new Error(`base version must be x.y.z, got ${baseVersion}`);
  }
  return `${baseVersion}-preview.${build}`;
}

export function zipNameFromFeedYaml(text) {
  const pathLine = text.split("\n").find((line) => /^\s*path:\s*\S/.test(line));
  if (!pathLine) throw new Error("preview-mac.yml has no path");
  const raw = pathLine.replace(/^\s*path:\s*/, "").trim().replace(/^['"]|['"]$/g, "");
  const name = raw.split("/").pop() ?? "";
  if (!name.endsWith(".zip")) throw new Error(`update feed path is not a zip: ${raw}`);
  return name;
}

/** Point the feed at a file served next to preview-mac.yml. sha512 lines stay intact. */
export function localizeFeedYaml(text, zipFileName) {
  return text.split("\n").map((line) => {
    const url = /^(\s*(?:-\s*)?url:\s*)(\S.*?)\s*$/.exec(line);
    if (url?.[1]) return `${url[1]}${zipFileName}`;
    const path = /^(\s*path:\s*)(\S.*?)\s*$/.exec(line);
    if (path?.[1]) return `${path[1]}${zipFileName}`;
    return line;
  }).join("\n");
}

export function assertOutsideStayed({ oldVersion, oldPid, evidence, samples }) {
  const errors = [];
  const blocked = evidence.filter((event) => (
    event.event === "update-state"
    && event.pid === oldPid
    && event.status === "available"
    && event.installBlock === "location"
  ));
  if (blocked.length === 0) errors.push("outside app did not report installBlock=location");
  if (evidence.some((event) => event.pid === oldPid && (
    event.event === "quit-and-install"
    || event.event === "update-accepted"
    || event.event === "control-socket-closed"
  ))) {
    errors.push("outside app accepted an update or closed its control socket");
  }
  const started = samples.findIndex((sample) => sample.socketExists && sample.oldPidAlive);
  if (started < 0) errors.push("outside control socket never opened");
  else if (samples.slice(started).some((sample) => (
    sample.version !== oldVersion || sample.oldPidAlive === false || sample.socketExists === false
  ))) {
    errors.push("outside app changed version, exited, or closed its control socket");
  }
  return errors;
}

export function assertInstalledUpdate({ oldVersion, newVersion, oldPid, evidence, samples, socketPath }) {
  const errors = [];
  const closed = evidence.filter((event) => event.event === "control-socket-closed" && event.pid === oldPid);
  if (closed.length === 0) errors.push("old process did not record control-socket-closed");
  if (socketPath && closed[0] && closed[0].socket !== socketPath) {
    errors.push(`control socket closed at ${closed[0].socket}, watcher used ${socketPath}`);
  }
  if (!evidence.some((event) => event.event === "update-accepted" && event.pid === oldPid)) {
    errors.push("old process did not accept the update");
  }
  if (!evidence.some((event) => event.event === "quit-and-install" && event.pid === oldPid)) {
    errors.push("old process did not call quitAndInstall");
  }
  if (!samples.some((sample) => sample.oldPidAlive && sample.version === oldVersion)) {
    errors.push("never observed the old version while the old process was alive");
  }
  if (samples.some((sample) => sample.oldPidAlive && sample.version === newVersion)) {
    errors.push("bundle changed to the new version while the old process was still running");
  }
  if (!samples.some((sample) => sample.oldPidAlive === false && sample.version === newVersion && sample.newPid > 0)) {
    errors.push("app did not relaunch as the new version after the old process exited");
  }
  const closedAt = closed[0] ? Date.parse(closed[0].timestamp) : NaN;
  if (Number.isFinite(closedAt)) {
    const early = samples.find((sample) => sample.version === newVersion && Date.parse(sample.t) <= closedAt);
    if (early) errors.push("new version was visible at or before the control socket closed");
  }
  return errors;
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  appendFileSync(transcriptPath, line);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
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
  if (result.status !== 0) {
    throw new Error(result.stderr || `cannot read ${plist}`);
  }
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

function socketAlive(socketPath) {
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

function findFiles(root, name) {
  const result = spawnSync("find", [root, "-name", name, "-type", "f"], { encoding: "utf8" });
  return (result.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function tryBundleVersion(appPath) {
  try {
    return bundleVersion(appPath);
  } catch {
    return "";
  }
}

function walkApps(root) {
  return spawnSync("find", [root, "-type", "d", "-name", "Backchat.app"], { encoding: "utf8" }).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function serveFeed(directory) {
  const server = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
    const base = name.replace(/^\/+/, "");
    log(`feed ${request.method} ${name}`);
    if (!base || base.includes("/") || base.includes("\\") || base.includes("..")) {
      response.writeHead(404);
      response.end();
      return;
    }
    const file = join(directory, base);
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Length": size,
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    createReadStream(file).pipe(response);
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("feed server has no port");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
  };
}

function launch(appPath, feedUrl, accept, logPath) {
  const binary = join(appPath, "Contents", "MacOS", "Backchat");
  mkdirSync(resolve(logPath, ".."), { recursive: true });
  const handle = openSync(logPath, "a");
  const env = { ...process.env };
  env.BACKCHAT_UPDATE_E2E = "1";
  env.BACKCHAT_UPDATE_FEED_URL = feedUrl;
  delete env.BACKCHAT_UPDATE_ACCEPT;
  delete env.BACKCHAT_TEST_HOOKS;
  delete env.ELECTRON_RUN_AS_NODE;
  if (accept) env.BACKCHAT_UPDATE_ACCEPT = "1";
  const child = spawn(binary, [], {
    env,
    detached: true,
    stdio: ["ignore", handle, handle],
  });
  closeSync(handle);
  child.unref();
  if (!child.pid) throw new Error(`failed to launch ${binary}`);
  log(`launched pid=${child.pid} accept=${accept ? "1" : "0"} ${binary}`);
  return child.pid;
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

function dumpFile(file) {
  log(`--- ${file} ---`);
  try {
    const text = readFileSync(file, "utf8").trimEnd();
    log(text || "(empty)");
  } catch (error) {
    log(error && error.code === "ENOENT" ? "(missing)" : String(error));
  }
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

async function sampleApp(appPath, pid, socketPath) {
  return {
    t: new Date().toISOString(),
    oldPidAlive: pidAlive(pid),
    newPid: relaunchedPid(pid),
    socketExists: await socketAlive(socketPath),
    version: tryBundleVersion(appPath),
  };
}

async function main() {
  if (process.platform !== "darwin") throw new Error("macos-update-e2e runs on macOS");
  mkdirSync(resolve("test-results"), { recursive: true });
  writeFileSync(transcriptPath, "");
  const releaseRoot = resolve(process.argv[2] ?? "release");
  const baseVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;
  const oldVersion = previewVersion(baseVersion, OLD_PREVIEW_BUILD);
  const newVersion = previewVersion(baseVersion, NEW_PREVIEW_BUILD);
  const apps = walkApps(releaseRoot);
  const oldApp = apps.find((app) => bundleVersion(app) === oldVersion);
  const newApp = apps.find((app) => bundleVersion(app) === newVersion);
  if (!oldApp || !newApp) {
    throw new Error(`missing signed apps for ${oldVersion} and ${newVersion} under ${releaseRoot}: ${apps.join(", ")}`);
  }
  log(`old=${oldApp}`);
  log(`new=${newApp}`);
  requireDeveloperId(oldApp);
  requireDeveloperId(newApp);

  const ymls = findFiles(releaseRoot, "preview-mac.yml").filter((file) => file.includes(newVersion));
  if (ymls.length !== 1) throw new Error(`expected one ${newVersion} preview-mac.yml, found ${ymls.join(", ")}`);
  const ymlPath = ymls[0];
  const ymlText = readFileSync(ymlPath, "utf8");
  const zipName = zipNameFromFeedYaml(ymlText);
  const zipCandidates = findFiles(releaseRoot, zipName);
  if (zipCandidates.length !== 1) throw new Error(`expected one ${zipName}, found ${zipCandidates.join(", ")}`);
  const feedDir = join(tmpdir(), "backchat-update-feed");
  rmSync(feedDir, { recursive: true, force: true });
  mkdirSync(feedDir, { recursive: true });
  writeFileSync(join(feedDir, "preview-mac.yml"), `${localizeFeedYaml(ymlText, zipName)}\n`);
  run("/usr/bin/ditto", [zipCandidates[0], join(feedDir, zipName)]);
  const feed = await serveFeed(feedDir);
  log(`feed ${feed.url}`);
  const socketPath = join(homedir(), ".oma", "control.sock");
  log(`control socket ${socketPath}`);

  const outside = join(tmpdir(), "backchat-update-outside", "Backchat.app");
  try {
    placeApp(oldApp, outside);
    if (bundleVersion(outside) !== oldVersion) throw new Error("outside copy version changed during ditto");
    rmSync(UPDATE_E2E_EVIDENCE_PATH, { force: true });
    const outsideLog = resolve("test-results/outside-app.log");
    const outsidePid = launch(outside, feed.url, false, outsideLog);
    const outsideSamples = [];
    const outsideDeadline = Date.now() + 90_000;
    let outsideEvidence = [];
    while (Date.now() < outsideDeadline) {
      const sample = await sampleApp(outside, outsidePid, socketPath);
      outsideSamples.push(sample);
      outsideEvidence = readEvidence();
      const ready = outsideEvidence.some((event) => (
        event.pid === outsidePid && event.status === "available" && event.installBlock === "location"
      ));
      if (ready && outsideSamples.length >= 2) break;
      await delay(500);
    }
    log("outside evidence:");
    dumpFile(UPDATE_E2E_EVIDENCE_PATH);
    const outsideErrors = assertOutsideStayed({
      oldVersion,
      oldPid: outsidePid,
      evidence: outsideEvidence,
      samples: outsideSamples,
    });
    if (outsideErrors.length) throw new Error(outsideErrors.join("\n"));
    log("outside copy stayed on the old version");
    process.kill(outsidePid, "SIGTERM");
    const quitDeadline = Date.now() + 30_000;
    while (pidAlive(outsidePid) && Date.now() < quitDeadline) await delay(200);
    if (pidAlive(outsidePid)) {
      process.kill(outsidePid, "SIGKILL");
      throw new Error("outside app did not exit after SIGTERM");
    }
    const socketDeadline = Date.now() + 10_000;
    while (await socketAlive(socketPath) && Date.now() < socketDeadline) await delay(200);
    if (await socketAlive(socketPath)) throw new Error("outside control socket stayed open");

    const installed = "/Applications/Backchat.app";
    placeApp(oldApp, installed);
    if (bundleVersion(installed) !== oldVersion) throw new Error("/Applications version is not the old preview");
    rmSync(UPDATE_E2E_EVIDENCE_PATH, { force: true });
    const installedLog = resolve("test-results/installed-app.log");
    const installedPid = launch(installed, feed.url, true, installedLog);
    const installedSamples = [];
    const installDeadline = Date.now() + 8 * 60_000;
    let installedEvidence = [];
    while (Date.now() < installDeadline) {
      const sample = await sampleApp(installed, installedPid, socketPath);
      installedSamples.push(sample);
      installedEvidence = readEvidence();
      const proved = assertInstalledUpdate({
        oldVersion,
        newVersion,
        oldPid: installedPid,
        evidence: installedEvidence,
        samples: installedSamples,
        socketPath,
      }).length === 0;
      if (proved) break;
      await delay(500);
    }
    log("installed evidence:");
    dumpFile(UPDATE_E2E_EVIDENCE_PATH);
    log(`CFBundleShortVersionString=${tryBundleVersion(installed)}`);
    log(installedSamples.map((sample) => JSON.stringify(sample)).join("\n"));
    const installErrors = assertInstalledUpdate({
      oldVersion,
      newVersion,
      oldPid: installedPid,
      evidence: installedEvidence,
      samples: installedSamples,
      socketPath,
    });
    if (installErrors.length) throw new Error(installErrors.join("\n"));
    log(`old pid ${installedPid} exited and ${installed} is ${newVersion}`);
    writeFileSync(resolve("test-results/backchat-update-evidence.log"), readFileSync(UPDATE_E2E_EVIDENCE_PATH));
  } finally {
    await feed.close();
    const quitting = spawnSync("pgrep", ["-x", "Backchat"], { encoding: "utf8" });
    for (const pid of (quitting.stdout ?? "").split("\n").map((line) => Number(line.trim())).filter((pid) => pid > 0)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    try {
      log(message);
      dumpFile("test-results/outside-app.log");
      dumpFile("test-results/installed-app.log");
      dumpFile(UPDATE_E2E_EVIDENCE_PATH);
    } catch {
      console.error(message);
    }
    process.exitCode = 1;
  });
}
