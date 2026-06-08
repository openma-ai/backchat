/**
 * Official ACP Registry — fetch, cache, and map to our internal shape.
 *
 * Source of truth: https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
 * Maintained by the ACP project (Apache 2.0). Auto-updated hourly by their CI
 * when upstream agents publish new versions.
 *
 *   1. App startup: try to fetch the official JSON. Cache to disk with
 *      `fetchedAt`.
 *   2. Subsequent loads: serve from cache while it's fresh (1h matches
 *      their cron).
 *   3. Network failure: keep using stale cache forever.
 *   4. Cold start with no cache and no network: caller falls back to the
 *      static overlay (see registry.ts:loadRegistry).
 *
 * Vendored from @open-managed-agents/acp-runtime (Apache-2.0).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentSpec } from "./types.js";
import type { KnownAgentEntry } from "./known-agents.js";

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export interface OfficialRegistryAgent {
  id: string;
  name: string;
  version?: string;
  description?: string;
  repository?: string;
  website?: string;
  license?: string;
  distribution: {
    npx?: { package: string; args?: string[]; env?: Record<string, string> };
    binary?: Record<string, { archive: string; cmd: string; args?: string[] }>;
    uvx?: { package: string; args?: string[]; env?: Record<string, string> };
  };
}

interface OfficialRegistry {
  version: number;
  agents: OfficialRegistryAgent[];
  extensions?: unknown[];
}

interface CachedRegistry {
  fetchedAt: number;
  data: OfficialRegistry;
}

export async function fetchOfficialRegistry(opts?: {
  cachePath?: string;
  ttlMs?: number;
  cacheOnly?: boolean;
}): Promise<OfficialRegistry> {
  const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const cachePath = opts?.cachePath;

  if (cachePath) {
    const cached = await readCache(cachePath);
    if (cached && Date.now() - cached.fetchedAt < ttl) return cached.data;
    if (cached && opts?.cacheOnly) return cached.data;
  }

  if (opts?.cacheOnly) {
    throw new Error("registry cacheOnly=true but no cache exists");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`registry fetch HTTP ${res.status}`);
    const data = (await res.json()) as OfficialRegistry;
    if (!Array.isArray(data?.agents)) {
      throw new Error("registry JSON malformed (no .agents array)");
    }
    if (cachePath) {
      await writeCache(cachePath, { fetchedAt: Date.now(), data }).catch(() => {});
    }
    return data;
  } catch (e) {
    if (cachePath) {
      const stale = await readCache(cachePath);
      if (stale) return stale.data;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function readCache(path: string): Promise<CachedRegistry | null> {
  try {
    const text = await readFile(path, "utf-8");
    const obj = JSON.parse(text) as CachedRegistry;
    if (typeof obj?.fetchedAt !== "number" || !Array.isArray(obj?.data?.agents)) return null;
    return obj;
  } catch { return null; }
}

async function writeCache(path: string, c: CachedRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(c, null, 2), "utf-8");
}

export function mapOfficialAgent(o: OfficialRegistryAgent): KnownAgentEntry | null {
  const platformKey = `${process.platform === "win32" ? "windows" : process.platform}-${
    process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
  }`;

  let spec: AgentSpec | null = null;
  let installHint: string | undefined;
  let install: KnownAgentEntry["install"] | undefined;

  if (o.distribution.binary?.[platformKey]) {
    const b = o.distribution.binary[platformKey];
    const command = b.cmd.replace(/^\.\//, "").replace(/\.exe$/, "");
    spec = { command, args: b.args };
    installHint = `download ${b.archive} and place \`${command}\` on PATH`;
    const archives: Record<string, { url: string; cmd: string }> = {};
    for (const [k, v] of Object.entries(o.distribution.binary)) {
      archives[k] = { url: v.archive, cmd: v.cmd };
    }
    install = { kind: "binary", archives, downloadUrl: o.repository };
  } else if (o.distribution.npx) {
    const n = o.distribution.npx;
    spec = { command: "npx", args: ["-y", n.package, ...(n.args ?? [])], env: n.env };
    installHint = `npx -y ${n.package}` + (n.args ? " " + n.args.join(" ") : "");
    const lastAt = n.package.lastIndexOf("@");
    const pkgName = lastAt > 0 ? n.package.slice(0, lastAt) : n.package;
    install = { kind: "npm", package: pkgName };
  } else if (o.distribution.uvx) {
    const u = o.distribution.uvx;
    spec = { command: "uvx", args: [u.package, ...(u.args ?? [])], env: u.env };
    installHint = `uvx ${u.package}` + (u.args ? " " + u.args.join(" ") : "");
  }

  if (!spec) return null;

  return {
    id: o.id,
    label: o.name,
    spec,
    version: o.version,
    installHint,
    install,
    homepage: o.website ?? o.repository,
  };
}
