import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { skillDirectoryForAgent } from "./agent-skill-directories.js";

export interface InjectableSkill {
  id: string;
  name: string;
  directory: string;
}

interface ManagedSkillLink {
  id: string;
  source: string;
  target: string;
}

interface ManagedSkillLinkState {
  version: 1;
  cwd: string;
  registryDirectory: string;
  links: ManagedSkillLink[];
}

export interface ReconcileSkillLinksInput {
  cwd: string;
  agentId: string;
  stateRoot: string;
  skills: readonly InjectableSkill[];
}

export interface ReconcileSkillLinksResult {
  linked: string[];
  removed: string[];
  conflicts: string[];
}

const reconciliationTails = new Map<string, Promise<void>>();

function isMissing(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}

function safeSkillName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return null;
  if (basename(trimmed) !== trimmed) return null;
  return /^[a-zA-Z0-9._-]+$/.test(trimmed) ? trimmed : null;
}

function stateFile(
  stateRoot: string,
  cwd: string,
  registryDirectory: string,
): string {
  const id = createHash("sha256")
    .update(cwd)
    .update("\0")
    .update(registryDirectory)
    .digest("hex");
  return join(stateRoot, `${id}.json`);
}

async function readState(path: string): Promise<ManagedSkillLinkState | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<ManagedSkillLinkState>;
    if (value.version !== 1 || !Array.isArray(value.links)) return null;
    return value as ManagedSkillLinkState;
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function symlinkDestination(path: string): Promise<string | null> {
  try {
    const destination = await readlink(path);
    return resolve(dirname(path), destination);
  } catch (error) {
    if (isMissing(error)) return null;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EINVAL" || code === "UNKNOWN") return null;
    throw error;
  }
}

/**
 * Reconcile native project skill links for one cwd/agent pair.
 *
 * The ledger lives under BackChat's data directory, outside the user's
 * project. A stale link is removed only when both its path and destination
 * still match the entry BackChat recorded, so user-owned paths are never
 * overwritten or deleted.
 */
async function reconcileSkillLinksUnlocked(
  input: ReconcileSkillLinksInput,
  cwd: string,
  registryDirectory: string,
): Promise<ReconcileSkillLinksResult> {
  const registryRoot = join(cwd, registryDirectory);
  const ledgerFile = stateFile(input.stateRoot, cwd, registryDirectory);
  const previous = await readState(ledgerFile);
  const linked: string[] = [];
  const removed: string[] = [];
  const conflicts: string[] = [];
  const desired: ManagedSkillLink[] = [];

  for (const skill of input.skills) {
    const name = safeSkillName(skill.name);
    if (!name) continue;
    const source = await realpath(skill.directory);
    desired.push({
      id: skill.id,
      source,
      target: join(registryRoot, name),
    });
  }
  const desiredTargets = new Set(desired.map((entry) => entry.target));

  for (const entry of previous?.links ?? []) {
    if (desiredTargets.has(entry.target)) continue;
    const destination = await symlinkDestination(entry.target);
    if (destination !== resolve(entry.source)) continue;
    await unlink(entry.target);
    removed.push(entry.target);
  }

  await mkdir(registryRoot, { recursive: true });
  const active: ManagedSkillLink[] = [];
  for (const entry of desired) {
    let stat;
    try {
      stat = await lstat(entry.target);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }

    if (!stat) {
      await symlink(
        entry.source,
        entry.target,
        process.platform === "win32" ? "junction" : "dir",
      );
      linked.push(entry.target);
      active.push(entry);
      continue;
    }

    if (!stat.isSymbolicLink()) {
      conflicts.push(entry.target);
      continue;
    }
    const destination = await symlinkDestination(entry.target);
    if (destination !== resolve(entry.source)) {
      const prior = previous?.links.find((link) => link.target === entry.target);
      if (prior && destination === resolve(prior.source)) {
        await unlink(entry.target);
        await symlink(
          entry.source,
          entry.target,
          process.platform === "win32" ? "junction" : "dir",
        );
        linked.push(entry.target);
        active.push(entry);
        continue;
      }
      conflicts.push(entry.target);
      continue;
    }
    active.push(entry);
  }

  await mkdir(input.stateRoot, { recursive: true });
  const state: ManagedSkillLinkState = {
    version: 1,
    cwd,
    registryDirectory,
    links: active,
  };
  await writeFile(ledgerFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return { linked, removed, conflicts };
}

export async function reconcileSkillLinks(
  input: ReconcileSkillLinksInput,
): Promise<ReconcileSkillLinksResult> {
  const cwd = await realpath(input.cwd);
  const registryDirectory = skillDirectoryForAgent(input.agentId);
  const key = `${cwd}\0${registryDirectory}`;
  const previous = reconciliationTails.get(key) ?? Promise.resolve();
  const run = previous.then(() =>
    reconcileSkillLinksUnlocked(input, cwd, registryDirectory));
  const tail = run.then(() => undefined, () => undefined);
  reconciliationTails.set(key, tail);
  try {
    return await run;
  } finally {
    if (reconciliationTails.get(key) === tail) {
      reconciliationTails.delete(key);
    }
  }
}
