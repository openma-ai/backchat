import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "apply-mac-update.sh");

function zipApp(appDir, zipPath) {
  const result = spawnSync("python3", ["-c", `
import os, sys, zipfile
app, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dest, "w") as zf:
    for root, dirs, files in os.walk(app):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, os.path.dirname(app)).replace(os.sep, "/")
            info = zipfile.ZipInfo(rel)
            info.external_attr = (os.stat(full).st_mode & 0xFFFF) << 16
            with open(full, "rb") as fh:
                zf.writestr(info, fh.read())
`, appDir, zipPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

async function makeApp(root, version, resultPath) {
  const app = resolve(root, "Backchat.app");
  const macos = resolve(app, "Contents", "MacOS");
  const resources = resolve(app, "Contents", "Resources");
  await mkdir(macos, { recursive: true });
  await mkdir(resources, { recursive: true });
  await writeFile(resolve(resources, "version"), version);
  await writeFile(resolve(resources, "result-path"), resultPath);
  const bin = resolve(macos, "Backchat");
  await writeFile(bin, `#!/bin/sh
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
version=$(cat "$root/Resources/version")
result=$(cat "$root/Resources/result-path")
printf '%s\\n' "$version" > "$result"
sleep 30
`);
  await chmod(bin, 0o755);
  return app;
}

async function runApply(args, env = {}) {
  const child = spawn("bash", [script, ...args], {
    env: { ...process.env, ...env },
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, "exit");
  return { code, stderr };
}

async function killPidFile(log) {
  try {
    const pid = Number((await readFile(`${log}.pid`, "utf8")).trim());
    if (pid > 0) process.kill(pid, "SIGTERM");
  } catch {
    // The helper may not have launched.
  }
}

test("replaces the bundle, starts the new version, and removes the backup", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-apply-ok-"));
  const resultPath = resolve(root, "result");
  const oldRoot = resolve(root, "old");
  const newRoot = resolve(root, "new");
  await mkdir(oldRoot, { recursive: true });
  await mkdir(newRoot, { recursive: true });
  const installed = await makeApp(oldRoot, "old", resultPath);
  const staged = await makeApp(newRoot, "new", resultPath);
  const zip = resolve(root, "update.zip");
  zipApp(staged, zip);
  const log = resolve(root, "apply.log");
  const live = spawn(resolve(installed, "Contents", "MacOS", "Backchat"), {
    detached: true,
    stdio: "ignore",
  });
  live.unref();
  try {
    const apply = runApply([
      "--pid", String(live.pid),
      "--app", installed,
      "--zip", zip,
      "--backup", resolve(root, "Backchat.app.previous"),
      "--log", log,
      "--relaunch", "exec",
      "--wait-seconds", "10",
    ]);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    process.kill(live.pid, "SIGTERM");
    const result = await apply;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(resolve(installed, "Contents", "Resources", "version"), "utf8"), "new");
    assert.equal((await readFile(resultPath, "utf8")).trim(), "new");
    await assert.rejects(readFile(resolve(root, "Backchat.app.previous", "Contents", "Resources", "version"), "utf8"));
    assert.match(await readFile(log, "utf8"), /update applied/);
  } finally {
    await killPidFile(log);
    try { process.kill(live.pid, "SIGTERM"); } catch { /* already exited */ }
    await rm(root, { recursive: true, force: true });
  }
});

test("restores the previous bundle when replacement fails after the swap", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-apply-rollback-"));
  const resultPath = resolve(root, "result");
  const oldRoot = resolve(root, "old");
  const newRoot = resolve(root, "new");
  await mkdir(oldRoot, { recursive: true });
  await mkdir(newRoot, { recursive: true });
  const installed = await makeApp(oldRoot, "old", resultPath);
  const staged = await makeApp(newRoot, "new", resultPath);
  const zip = resolve(root, "update.zip");
  zipApp(staged, zip);
  const log = resolve(root, "apply.log");
  const live = spawn(resolve(installed, "Contents", "MacOS", "Backchat"), {
    detached: true,
    stdio: "ignore",
  });
  live.unref();
  try {
    const apply = runApply([
      "--pid", String(live.pid),
      "--app", installed,
      "--zip", zip,
      "--backup", resolve(root, "Backchat.app.previous"),
      "--log", log,
      "--relaunch", "exec",
      "--wait-seconds", "10",
    ], { BACKCHAT_UPDATE_FAIL_AFTER: "swap" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    process.kill(live.pid, "SIGTERM");
    const result = await apply;
    assert.equal(result.code, 1, result.stderr);
    assert.equal(await readFile(resolve(installed, "Contents", "Resources", "version"), "utf8"), "old");
    assert.equal((await readFile(resultPath, "utf8")).trim(), "old");
    assert.match(await readFile(log, "utf8"), /rolled back/);
  } finally {
    await killPidFile(log);
    try { process.kill(live.pid, "SIGTERM"); } catch { /* already exited */ }
    await rm(root, { recursive: true, force: true });
  }
});

test("restores the previous bundle when the new version does not stay open", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-apply-launch-"));
  const resultPath = resolve(root, "result");
  const oldRoot = resolve(root, "old");
  const newRoot = resolve(root, "new");
  await mkdir(oldRoot, { recursive: true });
  await mkdir(newRoot, { recursive: true });
  const installed = await makeApp(oldRoot, "old", resultPath);
  const staged = await makeApp(newRoot, "new", resultPath);
  const zip = resolve(root, "update.zip");
  zipApp(staged, zip);
  const log = resolve(root, "apply.log");
  const live = spawn(resolve(installed, "Contents", "MacOS", "Backchat"), {
    detached: true,
    stdio: "ignore",
  });
  live.unref();
  try {
    const apply = runApply([
      "--pid", String(live.pid),
      "--app", installed,
      "--zip", zip,
      "--backup", resolve(root, "Backchat.app.previous"),
      "--log", log,
      "--relaunch", "exec",
      "--wait-seconds", "10",
    ], { BACKCHAT_UPDATE_FAIL_AFTER: "launch" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    process.kill(live.pid, "SIGTERM");
    const result = await apply;
    assert.equal(result.code, 1, result.stderr);
    assert.equal(await readFile(resolve(installed, "Contents", "Resources", "version"), "utf8"), "old");
    assert.equal((await readFile(resultPath, "utf8")).trim(), "old");
    assert.match(await readFile(log, "utf8"), /rolled back/);
  } finally {
    await killPidFile(log);
    try { process.kill(live.pid, "SIGTERM"); } catch { /* already exited */ }
    await rm(root, { recursive: true, force: true });
  }
});

test("does not touch the installed app when the zip escapes its directory", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "backchat-apply-slip-"));
  const resultPath = resolve(root, "result");
  const oldRoot = resolve(root, "old");
  await mkdir(oldRoot, { recursive: true });
  const installed = await makeApp(oldRoot, "old", resultPath);
  const zip = resolve(root, "evil.zip");
  const packed = spawnSync("python3", ["-c", `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as zf:
    zf.writestr("../Backchat.app/Contents/MacOS/Backchat", "#!/bin/sh\\necho pwned\\n")
`, zip], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const log = resolve(root, "apply.log");
  const finished = spawn("sleep", ["30"], { stdio: "ignore" });
  finished.kill("SIGTERM");
  await once(finished, "exit");
  try {
    const apply = await runApply([
      "--pid", String(finished.pid),
      "--app", installed,
      "--zip", zip,
      "--backup", resolve(root, "Backchat.app.previous"),
      "--log", log,
      "--relaunch", "none",
      "--wait-seconds", "5",
    ]);
    assert.equal(apply.code, 1, apply.stderr);
    assert.equal(await readFile(resolve(installed, "Contents", "Resources", "version"), "utf8"), "old");
    assert.match(await readFile(log, "utf8"), /escapes/);
    await assert.rejects(readFile(resultPath, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
