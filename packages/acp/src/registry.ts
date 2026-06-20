/**
 * Agent registry — merges the official ACP registry with the desktop's static
 * overlay, exposes a sync `which`-style detector.
 *
 * Two layers:
 *   - **overlay** (known-agents.ts): hand-curated featured entries plus a few
 *     agents the official registry doesn't carry (hermes, openclaw).
 *   - **official** (registry-fetch.ts): live JSON from
 *     cdn.agentclientprotocol.com, fetched once at startup, cached to disk.
 *
 * Detection rule: only entries whose spec.command resolves on $PATH count as
 * detected. For npx/uvx-based entries, additionally require the package to be
 * globally installed — `npx`/`uvx` are always on PATH once Node/uv are
 * installed, so the bare `which` check would lie.
 *
 * Vendored from @open-managed-agents/acp-runtime (Apache-2.0).
 */

import { spawn, spawnSync } from "node:child_process";
import {
  OVERLAY_AGENTS,
  resolveOverlayAgent,
  type KnownAgentEntry,
} from "./known-agents.js";
import { fetchOfficialRegistry, mapOfficialAgent } from "./registry-fetch.js";

export {
  OVERLAY_AGENTS,
  resolveOverlayAgent,
  type KnownAgentEntry,
} from "./known-agents.js";

let _mergedCache: KnownAgentEntry[] | null = null;
let _npmGlobalCache: Set<string> | null = null;
let _uvToolCache: Set<string> | null = null;

export async function loadRegistry(opts?: {
  cachePath?: string;
  ttlMs?: number;
  forceRefresh?: boolean;
}): Promise<KnownAgentEntry[]> {
  if (_mergedCache && !opts?.forceRefresh) return _mergedCache;
  let officialMapped: KnownAgentEntry[] = [];
  try {
    const reg = await fetchOfficialRegistry({ cachePath: opts?.cachePath, ttlMs: opts?.ttlMs });
    for (const o of reg.agents) {
      const m = mapOfficialAgent(o);
      if (m) officialMapped.push(m);
    }
  } catch (e) {
    process.stderr.write(
      `! ACP registry fetch failed (${(e as Error).message}); using overlay only\n`,
    );
    officialMapped = [];
  }
  _mergedCache = mergeOverlay(officialMapped, OVERLAY_AGENTS);
  return _mergedCache;
}

export function getKnownAgents(): readonly KnownAgentEntry[] {
  return _mergedCache ?? OVERLAY_AGENTS;
}

export function resolveKnownAgent(id: string): KnownAgentEntry | null {
  const list = getKnownAgents();
  for (const e of list) if (e.id === id) return e;
  return null;
}

function mergeOverlay(
  official: KnownAgentEntry[],
  overlay: KnownAgentEntry[],
): KnownAgentEntry[] {
  const overlayById = new Map(overlay.map((e) => [e.id, e]));
  const seenOverlay = new Set<string>();
  const merged: KnownAgentEntry[] = [];
  for (const o of official) {
    const ov = overlayById.get(o.id);
    if (ov) {
      seenOverlay.add(o.id);
      merged.push({
        ...o,
        label: ov.label || o.label,
        installHint: o.installHint || ov.installHint,
        homepage: o.homepage || ov.homepage,
        featured: ov.featured,
        wraps: ov.wraps,
        install: o.install ?? ov.install,
      });
    } else {
      merged.push(o);
    }
  }
  for (const ov of overlay) {
    if (!seenOverlay.has(ov.id)) merged.push(ov);
  }
  return merged;
}

export function _resetRegistryCache(): void {
  _mergedCache = null;
  _npmGlobalCache = null;
  _uvToolCache = null;
}

export async function detect(id: string): Promise<KnownAgentEntry | null> {
  const entry = resolveKnownAgent(id);
  if (!entry) return null;
  if (!(await isOnPath(entry.spec.command))) return null;
  if (
    entry.spec.command === "npx" &&
    !isNpxAutoInstallSpec(entry) &&
    !isNpxPackageInstalled(entry)
  ) return null;
  if (entry.spec.command === "uvx" && !isUvxPackageInstalled(entry)) return null;
  return entry;
}

function isNpxAutoInstallSpec(entry: KnownAgentEntry): boolean {
  return entry.spec.args?.[0] === "-y" && typeof entry.spec.args?.[1] === "string";
}

function isNpxPackageInstalled(entry: KnownAgentEntry): boolean {
  const pkgSpec = entry.spec.args?.[1];
  if (!pkgSpec) return false;
  const lastAt = pkgSpec.lastIndexOf("@");
  const pkgName = lastAt > 0 ? pkgSpec.slice(0, lastAt) : pkgSpec;
  const cache = _npmGlobalCache ?? (_npmGlobalCache = snapshotNpmGlobal());
  return cache.has(pkgName);
}

function isUvxPackageInstalled(entry: KnownAgentEntry): boolean {
  const pkgSpec = entry.spec.args?.[0];
  if (!pkgSpec) return false;
  let pkgName = pkgSpec;
  for (const sep of ["==", "@"]) {
    const idx = pkgName.indexOf(sep, 1);
    if (idx > 0) { pkgName = pkgName.slice(0, idx); break; }
  }
  const cache = _uvToolCache ?? (_uvToolCache = snapshotUvTool());
  return cache.has(pkgName);
}

function snapshotNpmGlobal(): Set<string> {
  try {
    const r = spawnSync("npm", ["ls", "-g", "--depth=0", "--parseable"], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (r.status !== 0 && !r.stdout) return new Set();
    const out = new Set<string>();
    for (const line of (r.stdout ?? "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.lastIndexOf("/node_modules/");
      if (idx < 0) continue;
      const tail = trimmed.slice(idx + "/node_modules/".length);
      if (tail) out.add(tail);
    }
    return out;
  } catch {
    return new Set();
  }
}

function snapshotUvTool(): Set<string> {
  try {
    const r = spawnSync("uv", ["tool", "list"], { encoding: "utf-8", timeout: 10_000 });
    if (r.status !== 0 && !r.stdout) return new Set();
    const out = new Set<string>();
    for (const line of (r.stdout ?? "").split("\n")) {
      if (!line || line.startsWith(" ") || line.startsWith("warning:")) continue;
      const m = line.match(/^([a-zA-Z0-9._-]+)\s+v?\d/);
      if (m && m[1]) out.add(m[1]);
    }
    return out;
  } catch {
    return new Set();
  }
}

function isOnPath(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = process.platform === "win32" ? "where" : "which";
    const p = spawn(probe, [cmd], { stdio: "ignore" });
    p.once("error", () => resolve(false));
    p.once("exit", (code) => resolve(code === 0));
  });
}

export async function detectAll(): Promise<KnownAgentEntry[]> {
  const list = getKnownAgents();
  const results = await Promise.all(list.map((e) => detect(e.id)));
  return results.filter((e): e is KnownAgentEntry => e !== null);
}
