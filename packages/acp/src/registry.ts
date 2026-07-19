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
 * Detection rule: registry-managed entries resolve from Backchat's managed
 * ACP bin directory. Only entries marked systemPath, plus custom overrides,
 * fall back to the user's system PATH.
 *
 * Vendored from @open-managed-agents/acp-runtime (Apache-2.0).
 */

import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import {
  OVERLAY_AGENTS,
  registryShimName,
  resolveOverlayAgent,
  type KnownAgentEntry,
} from "./known-agents.js";
import { fetchOfficialRegistry, mapOfficialAgent } from "./registry-fetch.js";

export {
  OVERLAY_AGENTS,
  registryShimName,
  resolveOverlayAgent,
  type KnownAgentEntry,
} from "./known-agents.js";

export interface ResolveAgentCommandOptions {
  env?: NodeJS.ProcessEnv;
  systemPathFallbackDirs?: string[];
  managedBinDirs?: string[];
}

let _mergedCache: KnownAgentEntry[] | null = null;
let _npmGlobalCache: Set<string> | null = null;
let _uvToolCache: Set<string> | null = null;

export async function loadRegistry(opts?: {
  cachePath?: string;
  ttlMs?: number;
  forceRefresh?: boolean;
  cacheOnly?: boolean;
}): Promise<KnownAgentEntry[]> {
  if (_mergedCache && !opts?.forceRefresh) return _mergedCache;
  let officialMapped: KnownAgentEntry[] = [];
  try {
    const reg = await fetchOfficialRegistry({
      cachePath: opts?.cachePath,
      ttlMs: opts?.ttlMs,
      cacheOnly: opts?.cacheOnly,
    });
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
        id: o.id,
        label: ov.label || o.label,
        icon: o.icon ?? ov.icon,
        spec: ov.spec,
        version: o.version,
        installHint: ov.installHint || o.installHint,
        homepage: ov.homepage || o.homepage,
        featured: ov.featured,
        systemPath: ov.systemPath,
        wraps: ov.wraps,
        install: ov.install ?? o.install,
        registryId: ov.registryId ?? o.registryId,
        registryDistribution: o.registryDistribution,
        installSource: ov.installSource ?? o.installSource,
        downloadUrl: ov.downloadUrl ?? o.downloadUrl,
        downloadKind: ov.downloadKind ?? o.downloadKind,
        configOptions: ov.configOptions ?? o.configOptions,
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

export async function detect(
  id: string,
  options: ResolveAgentCommandOptions = {},
): Promise<KnownAgentEntry | null> {
  const entry = resolveKnownAgent(id);
  if (!entry) return null;
  return detectEntry(entry, options);
}

export async function detectEntry(
  entry: KnownAgentEntry,
  options: ResolveAgentCommandOptions = {},
): Promise<KnownAgentEntry | null> {
  const managedCommand = await resolveManagedCommand(entry.spec.command, options);
  if (!managedCommand && entry.installSource === "registry" && !entry.systemPath) {
    return null;
  }
  const command = managedCommand ?? await resolveSystemCommand(entry, options);
  if (!command) return null;
  if (entry.spec.command === "npx" && !isNpxPackageInstalled(entry)) return null;
  if (entry.spec.command === "uvx" && !isUvxPackageInstalled(entry)) return null;
  const args =
    managedCommand && entry.installSource === "registry"
      ? undefined
      : entry.spec.args;
  return {
    ...entry,
    spec: {
      ...entry.spec,
      command,
      ...(args ? { args } : { args: undefined }),
    },
  };
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

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function splitPath(value: string | undefined): string[] {
  return value?.split(delimiter).filter(Boolean) ?? [];
}

function managedBinDirs(options: ResolveAgentCommandOptions): string[] {
  const env = options.env ?? process.env;
  return [...new Set([
    ...(options.managedBinDirs ?? []),
    ...splitPath(env.OPENMA_ACP_BIN_DIR),
  ])];
}

function systemBinDirs(options: ResolveAgentCommandOptions): string[] {
  const env = options.env ?? process.env;
  const home = env.HOME ?? env.USERPROFILE;
  const dirs = splitPath(env.PATH);
  if (options.systemPathFallbackDirs) {
    dirs.push(...options.systemPathFallbackDirs);
  } else {
    if (process.platform === "darwin") {
      dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin");
    }
    dirs.push("/usr/bin", "/bin");
  }
  if (env.PNPM_HOME) dirs.push(env.PNPM_HOME);
  if (env.VOLTA_HOME) dirs.push(join(env.VOLTA_HOME, "bin"));
  if (home) {
    dirs.push(
      join(home, ".volta", "bin"),
      join(home, ".asdf", "shims"),
      join(home, ".local", "share", "mise", "shims"),
      join(home, ".mise", "shims"),
      join(home, ".local", "bin"),
      join(home, "Library", "pnpm"),
      join(home, ".bun", "bin"),
    );
  }
  return [...new Set(dirs)];
}

async function candidateNodeVersionDirs(root: string, suffix: string[]): Promise<string[]> {
  const dirs: string[] = [];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(root, entry.name, ...suffix));
    }
  } catch {
    // Optional toolchain manager; absence just means no extra bins.
  }
  return dirs;
}

async function systemBinDirsWithNodeManagers(options: ResolveAgentCommandOptions): Promise<string[]> {
  const env = options.env ?? process.env;
  const home = env.HOME ?? env.USERPROFILE;
  const dirs = systemBinDirs(options);
  const nvmDir = env.NVM_DIR ?? (home ? join(home, ".nvm") : undefined);
  if (nvmDir) dirs.push(...(await candidateNodeVersionDirs(join(nvmDir, "versions", "node"), ["bin"])));
  const fnmDir = env.FNM_DIR ?? (home ? join(home, ".fnm") : undefined);
  if (fnmDir) dirs.push(...(await candidateNodeVersionDirs(join(fnmDir, "node-versions"), ["installation", "bin"])));
  return [...new Set(dirs)];
}

async function resolveCommandInDirs(command: string, dirs: string[]): Promise<string | null> {
  if (isAbsolute(command)) return await isExecutable(command) ? command : null;
  for (const dir of dirs) {
    const candidate = join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function resolveManagedCommand(
  command: string,
  options: ResolveAgentCommandOptions,
): Promise<string | null> {
  return resolveCommandInDirs(command, managedBinDirs(options));
}

async function resolveSystemCommand(
  entry: KnownAgentEntry,
  options: ResolveAgentCommandOptions,
): Promise<string | null> {
  if (entry.installSource === "registry" && entry.spec.command.startsWith(registryShimName(""))) {
    return null;
  }
  return resolveCommandInDirs(entry.spec.command, await systemBinDirsWithNodeManagers(options));
}

export async function detectAll(
  options: ResolveAgentCommandOptions = {},
): Promise<KnownAgentEntry[]> {
  const list = getKnownAgents();
  const results = await Promise.all(list.map((e) => detect(e.id, options)));
  return results.filter((e): e is KnownAgentEntry => e !== null);
}
