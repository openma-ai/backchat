import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { KnownAgentEntry } from "@open-managed-agents-desktop/acp/registry";

function sortedEnvRecord(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> {
  if (!env) return {};
  const entries = Object.entries(env)
    .filter(([name, value]) => name.length > 0 && typeof value === "string")
    .sort(([left], [right]) => left.localeCompare(right)) as Array<[string, string]>;
  return Object.fromEntries(entries);
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function codexAuthConfigSnapshot(probeCwd?: string): Promise<unknown> {
  const root = join(probeCwd ?? homedir(), ".codex");
  const configToml = await readTextIfExists(join(root, "config.toml"));
  const authJson = await readTextIfExists(join(root, "auth.json"));
  if (!configToml && !authJson) return null;
  return { configToml, authJson };
}

export async function computeAuthProbeInputsKey(
  entry: KnownAgentEntry,
  probeCwd?: string,
): Promise<string> {
  const payload: unknown = {
    command: entry.spec.command,
    args: entry.spec.args ?? [],
    env: sortedEnvRecord(entry.spec.env),
    ...(entry.id === "codex-acp"
      ? { codex: await codexAuthConfigSnapshot(probeCwd) }
      : {}),
  };
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}
