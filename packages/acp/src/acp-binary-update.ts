/**
 * acp-binary-update — best-effort self-update for ACP agent binaries.
 *
 * Backchat doesn't ship binaries; the user installs them out-of-band (e.g.
 * a wrappers/ dir under ~/.local/share/oma/). When the official registry
 * advertises a newer version than what the user's local binary actually
 * reports via `initialize.result.agentInfo.version`, this module downloads
 * the new archive, extracts the binary, and atomically swaps the resolved
 * `cmd` file on disk.
 *
 * Strict policy:
 *   - Synchronous version probe (spawn-init-kill cycle, ~150-500ms cold,
 *     skipped if we already probed recently — see `probeCache`).
 *   - All errors swallowed (network down / permission denied / arch
 *     mismatch / not a tar.gz / etc.) — backchat falls through to "spawn
 *     whatever's there now", same as before.
 *   - Only acts on `install.kind === "binary"` entries. npm packages are
 *     left to npm's own update story (manual `npm i -g`).
 *
 * Trigger site: SessionManager.start() awaits this once per agent_id at
 * most every probeTtl ms. First-launch users wait through one download
 * (~180MB for codex-acp); subsequent launches are instant.
 */

import { spawn } from "node:child_process";
import { createWriteStream, statSync } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract as tarExtract } from "tar";

import type { KnownAgentEntry } from "./known-agents.js";

interface ProbeResult {
  installed: string | null;
  checkedAt: number;
}

/** Per-agent-id probe cache so we don't spawn-and-init the binary on every
 *  session.start. Keyed by agent id; TTL keeps the freshness lifetime
 *  short enough that a hand-replaced binary is picked up within an hour
 *  without the user restarting backchat. */
const probeCache = new Map<string, ProbeResult>();
const PROBE_TTL_MS = 60 * 60 * 1000;

export interface EnsureLatestOpts {
  /** Registry-advertised version string (`x.y.z`). When undefined, we skip
   *  the comparison and never update. */
  registryVersion?: string;
  /** Same shape as `KnownAgentEntry.install`. Only `binary` kind is acted
   *  upon. */
  install?: KnownAgentEntry["install"];
  /** Override for the command-on-PATH lookup. Defaults to the agent's
   *  registered `spec.command`. */
  command: string;
}

/** Ensure the on-disk ACP binary for `agentId` is at the registry-advertised
 *  version. No-op when it already is, when the install kind isn't binary,
 *  or when anything along the way throws. Awaited inline so the session
 *  spawn picks up the fresh binary. */
export async function ensureLatestAcpBinary(
  agentId: string,
  opts: EnsureLatestOpts,
): Promise<void> {
  const { registryVersion, install, command } = opts;
  if (!registryVersion) return;
  if (!install || install.kind !== "binary") return;

  // Resolve archive for this platform. `mapOfficialAgent` already keyed
  // archives by `${platform}-${arch}`; we look up the same key here.
  const platformKey = `${process.platform === "win32" ? "windows" : process.platform}-${
    process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
  }`;
  const archive = install.archives[platformKey];
  if (!archive?.url) return;

  // Resolve the binary's on-disk path. The wrapper layout
  // (~/.local/share/oma/wrappers/<id>/<cmd>) was created by the
  // out-of-band installer; we mirror that here when present so updates
  // land in the same spot the symlink-on-PATH points at. Falls back to
  // ${tmpdir}/oma-acp-binaries/ — that won't be on PATH, so without the
  // wrappers layout the update is a no-op (logged).
  const wrappersDir = join(homedir(), ".local", "share", "oma", "wrappers", agentId);
  const binPath = join(wrappersDir, command);
  if (!fileExists(binPath)) {
    return; // No installed wrappers entry — leave it to the user's installer.
  }

  // Probe the binary's actual version. Cached for PROBE_TTL_MS to avoid
  // a spawn per session.start.
  const cached = probeCache.get(agentId);
  let installedVersion = cached?.installed;
  if (!cached || Date.now() - cached.checkedAt > PROBE_TTL_MS) {
    installedVersion = await probeBinaryVersion(binPath).catch(() => null);
    probeCache.set(agentId, { installed: installedVersion, checkedAt: Date.now() });
  }
  if (!installedVersion) return; // can't probe → don't gamble on an update

  if (compareSemver(installedVersion, registryVersion) >= 0) return; // already current

  // eslint-disable-next-line no-console
  console.log(
    `[acp-update] ${agentId}: ${installedVersion} → ${registryVersion} (downloading ${archive.url})`,
  );
  try {
    await downloadAndReplace(archive.url, archive.cmd, binPath);
    probeCache.set(agentId, { installed: registryVersion, checkedAt: Date.now() });
    // eslint-disable-next-line no-console
    console.log(`[acp-update] ${agentId}: updated to ${registryVersion}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[acp-update] ${agentId} update failed:`, e);
  }
  // Mark that we still need PATH resolution to find this — without the
  // user's wrapper-symlink, an updated wrappers/ binary won't reach the
  // spawn step. The PATH lookup itself isn't part of this module; we
  // trust the wrappers/ symlink the installer set up. If the symlink is
  // missing, the spawn will fail downstream with ENOENT — visible enough.
}

/** Spawn the binary with a minimal `initialize` request and read back its
 *  `agentInfo.version`. 5s timeout is enough for the cold-spawn path on
 *  any reasonable hardware and short enough to keep first-prompt latency
 *  bounded when the binary is hosed. */
async function probeBinaryVersion(binPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const child = spawn(binPath, [], { stdio: ["pipe", "pipe", "ignore"] });
    let stdoutBuf = "";
    const done = (v: string | null) => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* already dead */
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 5000);
    child.on("error", () => done(null));
    child.stdout?.on("data", (d) => {
      stdoutBuf += d.toString();
      const nl = stdoutBuf.indexOf("\n");
      if (nl === -1) return;
      const line = stdoutBuf.slice(0, nl);
      try {
        const msg = JSON.parse(line);
        const v = msg?.result?.agentInfo?.version;
        clearTimeout(timer);
        done(typeof v === "string" ? v : null);
      } catch {
        // Not the response yet — keep buffering, may be stray stderr/log.
      }
    });
    child.stdin?.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: false,
          },
        },
      }) + "\n",
    );
  });
}

/** Download archive, extract, and atomically replace the binary at
 *  `dest`. Throws on any step — caller swallows. `cmdInArchive` is the
 *  path inside the archive (often `./codex-acp` or `bin/codex-acp`); we
 *  strip the leading `./` for tar's filter. */
async function downloadAndReplace(
  archiveUrl: string,
  cmdInArchive: string,
  dest: string,
): Promise<void> {
  const stagingRoot = join(tmpdir(), "oma-acp-update", String(Date.now()));
  await mkdir(stagingRoot, { recursive: true });
  const archivePath = join(stagingRoot, "archive.tar.gz");

  // Download → archive.tar.gz
  const res = await fetch(archiveUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${archiveUrl}`);
  if (!res.body) throw new Error("response has no body");
  await pipeline(
    res.body as unknown as NodeJS.ReadableStream,
    createWriteStream(archivePath),
  );

  // Extract — strip `./` from the in-archive path so tar matches.
  const cmdEntry = cmdInArchive.replace(/^\.\//, "");
  const extractDir = join(stagingRoot, "extracted");
  await mkdir(extractDir, { recursive: true });
  await pipeline(
    (await import("node:fs")).createReadStream(archivePath),
    createGunzip(),
    tarExtract({ cwd: extractDir }),
  );

  // The extracted file may be the cmd verbatim or nested. We try the cmd
  // entry first, then a recursive fallback.
  const candidate = join(extractDir, cmdEntry);
  let stagedBin: string;
  if (fileExists(candidate)) {
    stagedBin = candidate;
  } else {
    const fallback = findBinary(extractDir, cmdEntry);
    if (!fallback) throw new Error(`binary "${cmdEntry}" not found in archive`);
    stagedBin = fallback;
  }

  // Atomic swap: write side-by-side then rename. macOS Gatekeeper will
  // see the new file as "unsigned, user-introduced" — that's fine, the
  // user already trusted backchat to download it.
  const swapPath = dest + ".new";
  await rename(stagedBin, swapPath);
  await chmod(swapPath, 0o755);
  await rename(swapPath, dest);

  // Best-effort cleanup of staging dir; ignore failures.
  await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
}

function fileExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Recursive search for a binary named `name` (or `name.exe`) inside
 *  `root`. Returns absolute path or null. Walk is shallow (depth 3) since
 *  ACP archives are typically flat. */
function findBinary(root: string, name: string): string | null {
  // Use a minimal sync walk so we don't pull in glob deps. Depth-limited.
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory() && depth < 3) stack.push({ dir: full, depth: depth + 1 });
      else if (e.isFile() && (e.name === name || e.name === name + ".exe")) return full;
    }
  }
  return null;
}

/** Tiny semver-ish compare. Returns negative when `a < b`, positive when
 *  `a > b`, zero when equal. Handles `x.y.z` and `x.y.z-tag` formats; the
 *  tag is ignored. Not a real semver lib — we don't need pre-release
 *  ordering, just "is the local copy strictly older". */
function compareSemver(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .replace(/^v/, "")
      .split("-")[0]!
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const aa = norm(a);
  const bb = norm(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
