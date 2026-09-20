import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { openmaRoot } from "./storage-root.js";
import type { WorkspaceRoot, WorkspaceWorktree } from "../shared/workspaces.js";

const execFile = promisify(execFileCallback);
const MANIFEST_NAME = "workspace.json";

export type ManagedWorktree = WorkspaceWorktree;

export interface PreparedWorktreeWorkspace {
  workspaceId: string;
  /** Directory that owns the manifest and every checkout below it. */
  rootDir: string;
  branch: string | null;
  sourceDirectories: string[];
  roots: WorkspaceRoot[];
  worktrees: WorkspaceWorktree[];
  cwd: string;
  additionalDirectories: string[];
  /** True only when this call created the checkouts. */
  created: boolean;
}

/** Manifest v1 keyed a checkout set by the session that created it. v2 keys it
 *  by workspace so several sessions can share one set. */
interface WorktreeManifestV1 {
  version: 1;
  sessionId: string;
  sourceDirectories: string[];
  roots: WorkspaceRoot[];
  worktrees: Array<Omit<WorkspaceWorktree, "branch">>;
}

interface WorktreeManifestV2 {
  version: 2;
  workspaceId: string;
  branch: string | null;
  sourceDirectories: string[];
  roots: WorkspaceRoot[];
  worktrees: WorkspaceWorktree[];
}

type WorktreeManifest = WorktreeManifestV1 | WorktreeManifestV2;

interface RepoPlan {
  repoRoot: string;
  head: string;
  path: string;
}

export interface LegacySessionWorktrees {
  sessionId: string;
  rootDir: string;
  sourceDirectories: string[];
  roots: WorkspaceRoot[];
  worktrees: WorkspaceWorktree[];
}

/** One line of `git worktree list --porcelain`, already grouped. */
export interface RepoWorktreeEntry {
  path: string;
  head: string;
  branch: string | null;
  /** The repository's primary checkout (the source folder itself). */
  isMain: boolean;
  /** Git still lists it but its directory is gone. */
  prunable: boolean;
}

/**
 * Creates Git worktrees owned by Backchat under one controlled directory.
 * Source paths are never modified. One workspace gets one checkout per source
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

  get root(): string {
    return this.#root;
  }

  async prepare(input: {
    workspaceId: string;
    sourceDirectories: string[];
    /** Branch to create in every repository. Detached when omitted. */
    branch?: string | null;
  }): Promise<PreparedWorktreeWorkspace> {
    const rootDir = this.#workspaceDir(input.workspaceId);
    const sourceDirectories = await canonicalSourceDirectories(
      input.sourceDirectories,
    );
    if (sourceDirectories.length === 0) {
      throw new Error("Worktree workspace requires at least one source directory");
    }

    const directoryAlreadyExists = await pathExists(rootDir);
    const existing = await this.#readManifest(rootDir);
    if (existing) {
      if (existing.version !== 2) {
        throw new Error(`Managed worktree manifest predates workspaces: ${rootDir}`);
      }
      if (existing.workspaceId !== input.workspaceId) {
        throw new Error(`Managed worktree manifest belongs to another workspace: ${rootDir}`);
      }
      if (!sameStrings(existing.sourceDirectories, sourceDirectories)) {
        throw new Error(
          `Workspace ${input.workspaceId} already owns worktrees for different source directories`,
        );
      }
      await validateExistingManifest(existing, rootDir);
      return resultFromManifest(existing, rootDir, false);
    }
    if (directoryAlreadyExists) {
      throw new Error(
        `Managed worktree directory exists without an ownership manifest: ${rootDir}`,
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
            rootDir,
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

    const branch = input.branch?.trim() || null;
    await mkdir(rootDir, { recursive: true });
    const created: RepoPlan[] = [];
    try {
      for (const plan of repoPlans) {
        await git(
          plan.repoRoot,
          "worktree",
          "add",
          ...(branch ? ["-b", branch] : ["--detach"]),
          plan.path,
          plan.head,
        );
        created.push(plan);
      }

      const manifest: WorktreeManifestV2 = {
        version: 2,
        workspaceId: input.workspaceId,
        branch,
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
          branch,
        })),
      };
      await this.#writeManifest(rootDir, manifest);
      return resultFromManifest(manifest, rootDir, true);
    } catch (error) {
      await rollbackCreatedWorktrees(created, rootDir);
      throw error;
    }
  }

  /** Remove every checkout below a workspace directory, then the directory. */
  async removeDir(rootDir: string): Promise<void> {
    if (!isWithin(this.#root, rootDir)) {
      throw new Error(`Refusing to remove a directory outside the managed root: ${rootDir}`);
    }
    const manifest = await this.#readManifest(rootDir);
    if (manifest) {
      for (const worktree of [...manifest.worktrees].reverse()) {
        if (!isWithin(rootDir, worktree.path)) continue;
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
        // The workspace branch goes with its checkout, but only via the safe
        // delete: git refuses when the branch carries unmerged commits, so
        // work the user has not integrated is never dropped silently.
        if (manifest.version === 2 && manifest.branch) {
          await git(worktree.repoRoot, "branch", "-d", manifest.branch).catch(() => "");
        }
      }
    }
    await rm(rootDir, { recursive: true, force: true });
  }

  async remove(workspaceId: string): Promise<void> {
    await this.removeDir(this.#workspaceDir(workspaceId));
  }

  /** Session-keyed checkout sets written before workspaces existed. */
  async listLegacy(): Promise<LegacySessionWorktrees[]> {
    let entries: string[];
    try {
      entries = await readdir(this.#root);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return [];
      throw error;
    }
    const result: LegacySessionWorktrees[] = [];
    for (const entry of entries) {
      const rootDir = join(this.#root, entry);
      const manifest = await this.#readManifest(rootDir).catch(() => null);
      if (!manifest || manifest.version !== 1) continue;
      result.push({
        sessionId: manifest.sessionId,
        rootDir,
        sourceDirectories: manifest.sourceDirectories,
        roots: manifest.roots,
        worktrees: manifest.worktrees.map((worktree) => ({ ...worktree, branch: null })),
      });
    }
    return result;
  }

  /** Rewrite a legacy manifest under a workspace id. Paths stay put. */
  async adoptLegacy(legacy: LegacySessionWorktrees, workspaceId: string): Promise<void> {
    const manifest: WorktreeManifestV2 = {
      version: 2,
      workspaceId,
      branch: null,
      sourceDirectories: legacy.sourceDirectories,
      roots: legacy.roots,
      worktrees: legacy.worktrees,
    };
    await this.#writeManifest(legacy.rootDir, manifest);
  }

  #workspaceDir(workspaceId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(workspaceId)) {
      throw new Error(`Invalid workspace id for managed worktree: ${workspaceId}`);
    }
    const candidate = resolve(this.#root, workspaceId);
    if (!isWithin(this.#root, candidate)) {
      throw new Error(`Managed worktree path escaped its root: ${workspaceId}`);
    }
    return candidate;
  }

  async #readManifest(rootDir: string): Promise<WorktreeManifest | null> {
    try {
      const value = JSON.parse(
        await readFile(join(rootDir, MANIFEST_NAME), "utf8"),
      ) as unknown;
      if (!isManifest(value)) {
        throw new Error(`Invalid managed worktree manifest: ${rootDir}`);
      }
      return value;
    } catch (error) {
      if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) return null;
      throw error;
    }
  }

  async #writeManifest(
    rootDir: string,
    manifest: WorktreeManifestV2,
  ): Promise<void> {
    const temporary = join(rootDir, `${MANIFEST_NAME}.tmp`);
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporary, join(rootDir, MANIFEST_NAME));
  }
}

export const defaultWorktreeStore = new ManagedWorktreeStore(
  join(openmaRoot(), "worktrees"),
);

/** Repository top level for a folder, canonicalized. Null outside Git. */
export async function repoRootOf(path: string): Promise<string | null> {
  try {
    const top = (await git(path, "rev-parse", "--show-toplevel")).trim();
    return await realpath(top);
  } catch {
    return null;
  }
}

export async function gitHeadInfo(path: string): Promise<{ head: string; branch: string | null }> {
  const head = (await git(path, "rev-parse", "HEAD")).trim();
  const ref = (await git(path, "rev-parse", "--abbrev-ref", "HEAD")).trim();
  return { head, branch: ref === "HEAD" ? null : ref };
}

/** Every checkout Git knows about for a repository, including ones Backchat
 *  did not create. Stale entries are pruned first so a deleted directory does
 *  not surface as a workspace. */
export async function listRepoWorktrees(repoRoot: string): Promise<RepoWorktreeEntry[]> {
  await git(repoRoot, "worktree", "prune").catch(() => "");
  const output = await git(repoRoot, "worktree", "list", "--porcelain");
  return parseWorktreeList(output);
}

export function parseWorktreeList(output: string): RepoWorktreeEntry[] {
  const entries: RepoWorktreeEntry[] = [];
  let current: Partial<RepoWorktreeEntry> | null = null;
  const flush = () => {
    if (current?.path) {
      entries.push({
        path: current.path,
        head: current.head ?? "",
        branch: current.branch ?? null,
        isMain: entries.length === 0,
        prunable: current.prunable ?? false,
      });
    }
    current = null;
  };
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) { flush(); continue; }
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length) };
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      current.branch = null;
    } else if (line.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  flush();
  return entries;
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
  manifest: WorktreeManifestV2,
  rootDir: string,
): Promise<void> {
  for (const worktree of manifest.worktrees) {
    if (!isWithin(rootDir, worktree.path)) {
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
  manifest: WorktreeManifestV2,
  rootDir: string,
  created: boolean,
): PreparedWorktreeWorkspace {
  return {
    workspaceId: manifest.workspaceId,
    rootDir,
    branch: manifest.branch,
    sourceDirectories: [...manifest.sourceDirectories],
    roots: manifest.roots.map((root) => ({ ...root })),
    worktrees: manifest.worktrees.map((worktree) => ({ ...worktree })),
    cwd: manifest.roots[0]!.effectivePath,
    additionalDirectories: manifest.roots.slice(1).map((root) => root.effectivePath),
    created,
  };
}

async function rollbackCreatedWorktrees(
  created: RepoPlan[],
  rootDir: string,
): Promise<void> {
  for (const plan of [...created].reverse()) {
    try {
      await git(plan.repoRoot, "worktree", "remove", "--force", plan.path);
    } catch {
      await rm(plan.path, { recursive: true, force: true });
      await git(plan.repoRoot, "worktree", "prune").catch(() => "");
    }
  }
  await rm(rootDir, { recursive: true, force: true });
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout;
}

export function safeName(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "repo";
}

export function isWithin(parent: string, child: string): boolean {
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

function isRootList(value: unknown): value is WorkspaceRoot[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((root) => !!root
      && typeof root.sourcePath === "string"
      && typeof root.effectivePath === "string"
      && Number.isInteger(root.worktreeIndex));
}

function isWorktreeList(value: unknown): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.every((worktree) => !!worktree
      && typeof worktree.repoRoot === "string"
      && typeof worktree.path === "string"
      && typeof worktree.head === "string");
}

function isManifest(value: unknown): value is WorktreeManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as {
    version?: unknown;
    sessionId?: unknown;
    workspaceId?: unknown;
    branch?: unknown;
    sourceDirectories?: unknown;
    roots?: unknown;
    worktrees?: unknown;
  };
  const common = Array.isArray(manifest.sourceDirectories)
    && manifest.sourceDirectories.every((path: unknown) => typeof path === "string")
    && isRootList(manifest.roots)
    && manifest.roots.length === manifest.sourceDirectories.length
    && isWorktreeList(manifest.worktrees);
  if (!common) return false;
  if (manifest.version === 1) return typeof manifest.sessionId === "string";
  if (manifest.version === 2) {
    return typeof manifest.workspaceId === "string"
      && (manifest.branch === null || typeof manifest.branch === "string");
  }
  return false;
}
