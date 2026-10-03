/**
 * macOS end to end: install an older Backchat.app, point the real download
 * checker at a local manifest, replace the bundle, and see the new build start.
 *
 * Production relaunches with /usr/bin/open. This runner executes the new
 * binary directly so Gatekeeper cannot block the job on an ad-hoc signature.
 * The helper still strips the quarantine attribute before that launch.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadVerifiedFile } from "../src/main/app-update-io.ts";

const commit = "0123456789abcdef0123456789abcdef01234567";
const script = resolve(dirname(fileURLToPath(import.meta.url)), "apply-mac-update.sh");

if (process.platform !== "darwin") {
  console.error("macos-update-e2e requires darwin");
  process.exit(1);
}

const root = await mkdtemp(resolve(tmpdir(), "backchat-macos-update-"));
const resultPath = resolve(root, "result");
const installedParent = resolve(root, "Applications");
const stagedParent = resolve(root, "staged");
await mkdir(installedParent, { recursive: true });
await mkdir(stagedParent, { recursive: true });

await makeApp(installedParent, "0.0.1");
await makeApp(stagedParent, "0.0.2");
const installed = resolve(installedParent, "Backchat.app");
const staged = resolve(stagedParent, "Backchat.app");
sign(installed);
sign(staged);
const quarantined = spawnSync("/usr/bin/xattr", [
  "-w",
  "com.apple.quarantine",
  "0081;00000000;BackchatE2E;",
  staged,
], { encoding: "utf8" });
if (quarantined.status !== 0) {
  console.error(quarantined.stderr);
  process.exit(quarantined.status ?? 1);
}

const zip = resolve(root, "Backchat-preview-arm64.zip");
const packed = spawnSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", staged, zip], { encoding: "utf8" });
if (packed.status !== 0) {
  console.error(packed.stderr);
  process.exit(packed.status ?? 1);
}
const zipBytes = await readFile(zip);
const sha256 = createHash("sha256").update(zipBytes).digest("hex");
const manifest = JSON.stringify({
  schema: 1,
  channel: "preview",
  version: "0.0.2",
  build: 2,
  commit,
  zipName: "Backchat-preview-arm64.zip",
  sha256,
  size: zipBytes.byteLength,
});

const server = createServer((request, response) => {
  const path = request.url?.split("?")[0];
  const body = path === "/Backchat-mac-arm64-update.json"
    ? Buffer.from(manifest)
    : path === "/Backchat-preview-arm64.zip"
      ? zipBytes
      : null;
  if (!body) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "content-length": String(body.byteLength) });
  response.end(body);
});
await new Promise<void>((listenResolve) => server.listen(0, "127.0.0.1", listenResolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("no port");
const base = `http://127.0.0.1:${address.port}`;
const verified = resolve(root, "verified.zip");
const log = resolve(root, "apply.log");
const live = spawn(resolve(installed, "Contents", "MacOS", "Backchat"), {
  detached: true,
  stdio: "ignore",
});
live.unref();

let exitCode = 0;
try {
  await downloadVerifiedFile({
    url: `${base}/Backchat-preview-arm64.zip`,
    sha256,
    size: zipBytes.byteLength,
    destination: verified,
  });
  const apply = spawn("bash", [
    script,
    "--pid", String(live.pid),
    "--app", installed,
    "--zip", verified,
    "--backup", resolve(root, "Backchat.app.previous"),
    "--log", log,
    "--relaunch", "exec",
    "--wait-seconds", "20",
  ], { stdio: "inherit" });
  await new Promise((wait) => setTimeout(wait, 300));
  try { process.kill(live.pid ?? 0, "SIGTERM"); } catch { /* already gone */ }
  const [code] = await once(apply, "exit");
  if (code !== 0) throw new Error(`apply helper exited ${code}`);
  const version = await readFile(resolve(installed, "Contents", "Resources", "version"), "utf8");
  const started = (await readFile(resultPath, "utf8")).trim();
  if (version !== "0.0.2" || started !== "0.0.2") {
    throw new Error(`expected version 0.0.2, bundle=${version} started=${started}`);
  }
  const quarantine = spawnSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", installed], { encoding: "utf8" });
  if (quarantine.status === 0) {
    throw new Error(`quarantine attribute remained: ${quarantine.stdout}`);
  }
  const helperLog = await readFile(log, "utf8");
  if (!helperLog.includes("update applied") || !helperLog.includes("quarantine cleared")) {
    throw new Error(`helper log missing success markers:\n${helperLog}`);
  }
  console.log("macos update e2e: 0.0.1 -> 0.0.2");
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  try {
    const pid = Number((await readFile(`${log}.pid`, "utf8")).trim());
    if (pid > 0) process.kill(pid, "SIGTERM");
  } catch { /* helper did not record a pid */ }
  try { process.kill(live.pid ?? 0, "SIGTERM"); } catch { /* already gone */ }
  await new Promise<void>((closeResolve) => server.close(() => closeResolve()));
  await rm(root, { recursive: true, force: true });
}
process.exit(exitCode);

async function makeApp(parent: string, version: string): Promise<void> {
  const macos = resolve(parent, "Backchat.app", "Contents", "MacOS");
  const resources = resolve(parent, "Backchat.app", "Contents", "Resources");
  await mkdir(macos, { recursive: true });
  await mkdir(resources, { recursive: true });
  await writeFile(resolve(resources, "version"), version);
  await writeFile(resolve(resources, "result-path"), resultPath);
  await writeFile(resolve(parent, "Backchat.app", "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Backchat</string>
  <key>CFBundleIdentifier</key><string>dev.openma.backchat.update-e2e</string>
  <key>CFBundleName</key><string>Backchat</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`);
  const bin = resolve(macos, "Backchat");
  await writeFile(bin, `#!/bin/sh
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
version=$(cat "$root/Resources/version")
result=$(cat "$root/Resources/result-path")
printf '%s\\n' "$version" > "$result"
sleep 30
`);
  await chmod(bin, 0o755);
}

function sign(app: string): void {
  const result = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", app], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "codesign failed");
  }
}
