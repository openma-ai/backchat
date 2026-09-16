import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { openmaRoot } from "./storage-root.js";

const execFile = promisify(execFileCallback);
const MANIFEST_NAME = "workspace.json";
const MANIFEST_VERSION = 1;

export interface ManagedWorktree {
  repoRoot: string;
  path: string;
  head: string;
}

export interface PreparedWorktreeWorkspace {
  cwd: string;
  additionalDirectories: string[];
  worktrees: ManagedWorktree[];
  /** True only when this call created the session's worktrees. */
  created: boolean;
}

interface WorkspaceRootMapping {
  sourcePath: string;
  effectivePath: string;
  worktreeIndex: number;
}

interface WorktreeManifest {
  version: 1;
  sessionId: string;
  sourceDirectories: string[];
  roots: WorkspaceRootMapping[];
  worktrees: ManagedWorktree[];
}

interface RepoPlan {
  repoRoot: string;
  head: string;
  path: string;
}

/**
 * Creates Git worktrees owned by Backchat under one controlled directory.
 * Source paths are never modified. One session gets one checkout per source
 * repository, while multiple roots inside the same repository are mapped into
 * that checkout.
 */
export class ManagedWorktreeStore {
  readonly #root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) {
      throw new Error(`Managed worktree root must be absolute: ${root}`);
    }
    this.#root = resolve(root);
  }

  async prepare(input: {
    sessionId: string;
    sourceDirectories: string[];
  }): Promise<PreparedWorktreeWorkspace> {
    const sessionDir = this.#sessionDir(input.sessionId);
    const sourceDirectories = await canonicalSourceDirectories(
      input.sourceDirectories,
    );
    if (sourceDirectories.length === 0) {
      throw new Error("Worktree workspace requires at least one source directory");
    }

    const sessionDirectoryAlreadyExists = await pathExists(sessionDir);
    const existing = await this.#readManifest(sessionDir);
    if (existing) {
      if (existing.sessionId !== input.sessionId) {
        throw new Error(`Managed worktree manifest belongs to another session: ${sessionDir}`);
      }
      if (!sameStrings(existing.sourceDirectories, sourceDirectories)) {
        throw new Error(
          `Session ${input.sessionId} already owns worktrees for different source directories`,
        );
      }
      await validateExistingManifest(existing, sessionDir);
      return resultFromManifest(existing, false);
    }
    if (sessionDirectoryAlreadyExists) {
      throw new Error(
        `Managed worktree directory exists without an ownership manifest: ${sessionDir}`,
      );
    }

    const repoByRoot = new Map<string, number>();
    const repoPlans: RepoPlan[] = [];
    const rootPlans: Array<{
      sourcePath: string;
      repoRoot: string;
      relativePath: string;
      worktreeIndex: number;
    }> = [];

    for (const sourcePath of sourceDirectories) {
      let repoRoot: string;
      try {
        repoRoot = await git(sourcePath, "rev-parse", "--show-toplevel");
      } catch {
        throw new Error(
          `Workspace root is not inside a Git repository: ${sourcePath}`,
        );
      }
      repoRoot = await realpath(repoRoot.trim());
      let worktreeIndex = repoByRoot.get(repoRoot);
      if (worktreeIndex === undefined) {
        worktreeIndex = repoPlans.length;
        repoByRoot.set(repoRoot, worktreeIndex);
        const head = (await git(repoRoot, "rev-parse", "HEAD")).trim();
        repoPlans.push({
          repoRoot,
          head,
          path: join(
            sessionDir,
            `${String(worktreeIndex + 1).padStart(2, "0")}-${safeName(basename(repoRoot))}`,
          ),
        });
      }
      rootPlans.push({
        sourcePath,
        repoRoot,
        relativePath: relative(repoRoot, sourcePath),
        worktreeIndex,
      });
    }

    await mkdir(sessionDir, { recursive: true });
    const created: RepoPlan[] = [];
    try {
      for (const plan of repoPlans) {
        await git(
          plan.repoRoot,
          "worktree",
          "add",
          "--detach",
          plan.path,
          plan.head,
        );
        created.push(plan);
      }

      const manifest: WorktreeManifest = {
        version: MANIFEST_VERSION,
        sessionId: input.sessionId,
        sourceDirectories,
        roots: rootPlans.map((rootPlan) => ({
          sourcePath: rootPlan.sourcePath,
          effectivePath: join(
            repoPlans[rootPlan.worktreeIndex]!.path,
            rootPlan.relativePath,
          ),
          worktreeIndex: rootPlan.worktreeIndex,
        })),
        worktrees: repoPlans.map(({ repoRoot, path, head }) => ({
          repoRoot,
          path,
          head,
        })),
      };
      await this.#writeManifest(sessionDir, manifest);
      return resultFromManifest(manifest, true);
    } catch (error) {
      await rollbackCreatedWorktrees(created, sessionDir);
      throw error;
    }
  }

  async remove(sessionId: string): Promise<void> {
    const sessionDir = this.#sessionDir(sessionId);
    const manifest = await this.#readManifest(sessionDir);
    if (!manifest) return;
    for (const worktree of [...manifest.worktrees].reverse()) {
      if (!isWithin(sessionDir, worktree.path)) continue;
      try {
        await git(
          worktree.repoRoot,
          "worktree",
          "remove",
          "--force",
          worktree.path,
        );
      } catch {
        await rm(worktree.path, { recursive: true, force: true });
        await git(worktree.repoRoot, "worktree", "prune").catch(() => "");
      }
    }
    await rm(sessionDir, { recursive: true, force: true });
  }

  #sessionDir(sessionId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) {
      throw new Error(`Invalid session id for managed worktree: ${sessionId}`);
    }
    const candidate = resolve(this.#root, sessionId);
    if (!isWithin(this.#root, candidate)) {
      throw new Error(`Managed worktree path escaped its root: ${sessionId}`);
    }
    return candidate;
  }

  async #readManifest(sessionDir: string): Promise<WorktreeManifest | null> {
    try {
      const value = JSON.parse(
        await readFile(join(sessionDir, MANIFEST_NAME), "utf8"),
      ) as unknown;
      if (!isManifest(value)) {
        throw new Error(`Invalid managed worktree manifest: ${sessionDir}`);
      }
      return value;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  async #writeManifest(
    sessionDir: string,
    manifest: WorktreeManifest,
  ): Promise<void> {
    const temporary = join(sessionDir, `${MANIFEST_NAME}.tmp`);
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporary, join(sessionDir, MANIFEST_NAME));
  }
}

const defaultStore = new ManagedWorktreeStore(
  join(openmaRoot(), "worktrees"),
);

export function prepareSessionWorktrees(input: {
  sessionId: string;
  sourceDirectories: string[];
}): Promise<PreparedWorktreeWorkspace> {
  return defaultStore.prepare(input);
}

export function removeSessionWorktrees(sessionId: string): Promise<void> {
  return defaultStore.remove(sessionId);
}

async function canonicalSourceDirectories(paths: string[]): Promise<string[]> {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawPath of paths) {
    const path = rawPath.trim();
    if (!path) continue;
    if (!isAbsolute(path)) {
      throw new Error(`Workspace root must be absolute: ${path}`);
    }
    let canonical: string;
    try {
      canonical = await realpath(path);
      await access(canonical);
    } catch {
      throw new Error(`Workspace root no longer exists: ${path}`);
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }
  return result;
}

async function validateExistingManifest(
  manifest: WorktreeManifest,
  sessionDir: string,
): Promise<void> {
  for (const worktree of manifest.worktrees) {
    if (!isWithin(sessionDir, worktree.path)) {
      throw new Error(`Managed worktree manifest escaped its root: ${worktree.path}`);
    }
    await access(worktree.path).catch(() => {
      throw new Error(`Managed worktree no longer exists: ${worktree.path}`);
    });
  }
  for (const root of manifest.roots) {
    const worktree = manifest.worktrees[root.worktreeIndex];
    if (!worktree || !isWithinOrEqual(worktree.path, root.effectivePath)) {
      throw new Error(
        `Managed workspace root escaped its worktree: ${root.effectivePath}`,
      );
    }
    await access(root.effectivePath).catch(() => {
      throw new Error(`Managed workspace root no longer exists: ${root.effectivePath}`);
    });
  }
}

function resultFromManifest(
  manifest: WorktreeManifest,
  created: boolean,
): PreparedWorktreeWorkspace {
  return {
    cwd: manifest.roots[0]!.effectivePath,
    additionalDirectories: manifest.roots.slice(1).map((root) => root.effectivePath),
    worktrees: manifest.worktrees.map((worktree) => ({ ...worktree })),
    created,
  };
}

async function rollbackCreatedWorktrees(
  created: RepoPlan[],
  sessionDir: string,
): Promise<void> {
  for (const plan of [...created].reverse()) {
    try {
      await git(plan.repoRoot, "worktree", "remove", "--force", plan.path);
    } catch {
      await rm(plan.path, { recursive: true, force: true });
      await git(plan.repoRoot, "worktree", "prune").catch(() => "");
    }
  }
  await rm(sessionDir, { recursive: true, force: true });
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout;
}

function safeName(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "repo";
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, resolve(child));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function isWithinOrEqual(parent: string, child: string): boolean {
  return resolve(parent) === resolve(child) || isWithin(parent, child);
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === code;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isManifest(value: unknown): value is WorktreeManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<WorktreeManifest>;
  return manifest.version === MANIFEST_VERSION
    && typeof manifest.sessionId === "string"
    && Array.isArray(manifest.sourceDirectories)
    && manifest.sourceDirectories.every((path) => typeof path === "string")
    && Array.isArray(manifest.roots)
    && manifest.roots.length > 0
    && manifest.roots.length === manifest.sourceDirectories.length
    && manifest.roots.every((root) => !!root
      && typeof root.sourcePath === "string"
      && typeof root.effectivePath === "string"
      && Number.isInteger(root.worktreeIndex))
    && Array.isArray(manifest.worktrees)
    && manifest.worktrees.length > 0
    && manifest.worktrees.every((worktree) => !!worktree
      && typeof worktree.repoRoot === "string"
      && typeof worktree.path === "string"
      && typeof worktree.head === "string");
}
