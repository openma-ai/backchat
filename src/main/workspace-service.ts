import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { basename, relative, join, isAbsolute, sep } from "node:path";
import {
  countSessionsForWorkspace,
  deleteWorkspace as deleteWorkspaceRow,
  getProject,
  getSession,
  getWorkspace as getWorkspaceRow,
  listProjects,
  listWorkspaces as listWorkspaceRows,
  saveWorkspace,
  setSessionWorkspace,
  type PersistedWorkspace,
} from "./sql-store.js";
import {
  defaultWorktreeStore,
  gitHeadInfo,
  listRepoWorktrees,
  repoRootOf,
  safeName,
  type ManagedWorktreeStore,
} from "./worktree-manager.js";
import {
  EXTERNAL_WORKSPACE_PREFIX,
  liveWorkspaceId,
  isExternalWorkspaceId,
  isLiveWorkspaceId,
  type WorkspaceInfo,
  type WorkspaceRoot,
  type WorkspaceWorktree,
} from "../shared/workspaces.js";
import type { ProjectInfo } from "../shared/projects.js";

/**
 * Project → Workspace → Worktree.
 *
 * Owns the three workspace kinds. Managed workspaces are the only stored
 * ones; live derives from the project and external from `git worktree list`.
 * Sessions reference a workspace by id and get their cwd / additional
 * directories from its roots, so "the code you see is the checkout you are
 * in" holds for every surface keyed on the session.
 */
export class WorkspaceService {
  readonly #store: ManagedWorktreeStore;

  constructor(store: ManagedWorktreeStore = defaultWorktreeStore) {
    this.#store = store;
  }

  async create(input: {
    project_id: string | null;
    name: string;
    /** Defaults to the project's source folders, primary first. */
    source_directories?: string[];
    created_by_session_id?: string | null;
  }): Promise<WorkspaceInfo> {
    const name = input.name.trim();
    if (!name) throw new Error("Workspace name is required");
    const project = input.project_id ? getProject(input.project_id) : null;
    if (input.project_id && !project) {
      throw new Error(`Project not found: ${input.project_id}`);
    }
    const sourceDirectories = input.source_directories?.length
      ? input.source_directories
      : project
        ? orderedProjectFolders(project)
        : [];
    if (sourceDirectories.length === 0) {
      throw new Error("Workspace needs at least one source folder");
    }
    const slug = safeName(name).toLowerCase().slice(0, 40);
    const suffix = randomBytes(2).toString("hex");
    const id = `ws-${slug}-${suffix}`;
    const branch = `backchat/${slug}-${suffix}`;
    const prepared = await this.#store.prepare({
      workspaceId: id,
      sourceDirectories,
      branch,
    });
    const row = saveWorkspace({
      id,
      project_id: input.project_id,
      name,
      branch: prepared.branch,
      root_dir: prepared.rootDir,
      source_directories: prepared.sourceDirectories,
      roots: prepared.roots,
      worktrees: prepared.worktrees,
      created_by_session_id: input.created_by_session_id ?? null,
    });
    return managedInfo(row);
  }

  /** Live + managed + external for one project, or for every project. */
  async list(projectId?: string): Promise<WorkspaceInfo[]> {
    const projects = projectId
      ? [getProject(projectId)].filter((p): p is ProjectInfo => !!p)
      : listProjects();
    const managed = listWorkspaceRows(projectId);
    const managedPaths = new Set(
      managed.flatMap((row) => row.worktrees.map((w) => w.path)),
    );
    const result: WorkspaceInfo[] = [];
    for (const project of projects) {
      result.push(await liveInfo(project));
    }
    result.push(...managed.map(managedInfo));
    for (const project of projects) {
      result.push(...await externalInfos(project, managedPaths, this.#store.root));
    }
    // Managed rows without a project (legacy worktree-mode sessions) still
    // deserve a listing when no project filter is applied.
    return result;
  }

  /** Resolve a workspace id for session start. External ids need the
   *  project to map its other roots; live ids map to the source folders. */
  async resolve(id: string, projectId?: string | null): Promise<WorkspaceInfo | null> {
    if (isLiveWorkspaceId(id)) {
      const project = getProject(id.slice("live:".length));
      return project ? liveInfo(project) : null;
    }
    if (isExternalWorkspaceId(id)) {
      const path = decodeExternalId(id);
      const project = projectId ? getProject(projectId) : null;
      return externalInfoForPath(path, project);
    }
    const row = getWorkspaceRow(id);
    return row ? managedInfo(row) : null;
  }

  async delete(id: string): Promise<void> {
    if (isLiveWorkspaceId(id)) throw new Error("The live workspace cannot be deleted");
    if (isExternalWorkspaceId(id)) {
      throw new Error("External worktrees are not managed by Backchat; remove them with git");
    }
    const row = getWorkspaceRow(id);
    if (!row) return;
    await this.#store.removeDir(row.root_dir);
    deleteWorkspaceRow(id);
  }

  /** Session-keyed checkout sets from before workspaces existed become
   *  managed workspaces named after their session. Orphans (session gone)
   *  are removed. Idempotent: adopted manifests are v2 and no longer listed. */
  async migrateLegacy(): Promise<{ adopted: number; removed: number }> {
    let adopted = 0;
    let removed = 0;
    for (const legacy of await this.#store.listLegacy()) {
      const session = getSession(legacy.sessionId);
      if (!session) {
        await this.#store.removeDir(legacy.rootDir).catch(() => undefined);
        removed++;
        continue;
      }
      const id = `ws-legacy-${safeName(legacy.sessionId)}`;
      await this.#store.adoptLegacy(legacy, id);
      // A short, stable label: the repo it checks out plus the session tag,
      // not the chat title (which is long and free-form).
      const repo = basename(legacy.sourceDirectories[0] ?? legacy.rootDir);
      saveWorkspace({
        id,
        project_id: session.project_id,
        name: `${repo} · ${legacy.sessionId.replace(/^sess-/, "")}`,
        branch: null,
        root_dir: legacy.rootDir,
        source_directories: legacy.sourceDirectories,
        roots: legacy.roots,
        worktrees: legacy.worktrees,
        created_by_session_id: legacy.sessionId,
        created_at: session.created_at,
      });
      setSessionWorkspace(legacy.sessionId, id);
      adopted++;
    }
    return { adopted, removed };
  }

  sessionCount(id: string): number {
    return countSessionsForWorkspace(id);
  }
}

export const workspaceService = new WorkspaceService();

/** Session-manager hook: turn a workspace reference (or a request for a
 *  fresh one) into the cwd + additional directories the agent should see. */
export async function prepareSessionWorkspace(input: {
  sessionId: string;
  projectId: string | null;
  sourceDirectories: string[];
  workspaceId?: string;
}): Promise<{
  workspaceId: string | null;
  cwd: string;
  additionalDirectories: string[];
  created: boolean;
}> {
  if (input.workspaceId) {
    const workspace = await workspaceService.resolve(input.workspaceId, input.projectId);
    if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);
    const mapped = mapRootsForSession(workspace, input.sourceDirectories);
    return {
      workspaceId: workspace.kind === "live" ? null : workspace.id,
      ...mapped,
      created: false,
    };
  }
  // Legacy worktree mode without a chosen workspace: a private managed
  // workspace named after the session.
  const workspace = await workspaceService.create({
    project_id: input.projectId,
    name: input.sessionId,
    source_directories: input.sourceDirectories,
    created_by_session_id: input.sessionId,
  });
  return { workspaceId: workspace.id, ...mapRootsForSession(workspace, input.sourceDirectories), created: true };
}

export async function discardSessionWorkspace(workspaceId: string): Promise<void> {
  await workspaceService.delete(workspaceId);
}

// -------------------- kinds --------------------

function orderedProjectFolders(project: ProjectInfo): string[] {
  const folders = project.source_folders.map((f) => f.trim()).filter(Boolean);
  const primary = project.primary_folder.trim();
  return primary && folders.includes(primary)
    ? [primary, ...folders.filter((f) => f !== primary)]
    : folders;
}

function managedInfo(row: PersistedWorkspace): WorkspaceInfo {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    kind: "managed",
    branch: row.branch,
    roots: row.roots,
    worktrees: row.worktrees,
    created_by_session_id: row.created_by_session_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function liveInfo(project: ProjectInfo): Promise<WorkspaceInfo> {
  const folders = orderedProjectFolders(project);
  const worktrees: WorkspaceWorktree[] = [];
  const indexByRepo = new Map<string, number>();
  const roots: WorkspaceRoot[] = [];
  for (const folder of folders) {
    const repoRoot = await repoRootOf(folder);
    if (!repoRoot) {
      roots.push({ sourcePath: folder, effectivePath: folder, worktreeIndex: -1 });
      continue;
    }
    let index = indexByRepo.get(repoRoot);
    if (index === undefined) {
      index = worktrees.length;
      indexByRepo.set(repoRoot, index);
      const info = await gitHeadInfo(repoRoot).catch(() => ({ head: "", branch: null }));
      worktrees.push({ repoRoot, path: repoRoot, ...info });
    }
    roots.push({ sourcePath: folder, effectivePath: folder, worktreeIndex: index });
  }
  return {
    id: liveWorkspaceId(project.id),
    project_id: project.id,
    name: "main",
    kind: "live",
    branch: worktrees[0]?.branch ?? null,
    roots,
    worktrees,
    created_by_session_id: null,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}

function encodeExternalId(path: string): string {
  return `${EXTERNAL_WORKSPACE_PREFIX}${Buffer.from(path, "utf8").toString("base64url")}`;
}

function decodeExternalId(id: string): string {
  return Buffer.from(id.slice(EXTERNAL_WORKSPACE_PREFIX.length), "base64url").toString("utf8");
}

/** Worktrees git knows about for the project's repositories that Backchat
 *  did not create. One workspace per external checkout; other repositories
 *  of the project fall back to their source folders. */
async function externalInfos(
  project: ProjectInfo,
  managedPaths: Set<string>,
  managedRoot: string,
): Promise<WorkspaceInfo[]> {
  const folders = orderedProjectFolders(project);
  const seenRepos = new Set<string>();
  const result: WorkspaceInfo[] = [];
  for (const folder of folders) {
    const repoRoot = await repoRootOf(folder);
    if (!repoRoot || seenRepos.has(repoRoot)) continue;
    seenRepos.add(repoRoot);
    let entries;
    try {
      entries = await listRepoWorktrees(repoRoot);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isMain || entry.prunable) continue;
      if (managedPaths.has(entry.path) || isInside(managedRoot, entry.path)) continue;
      if (!(await exists(entry.path))) continue;
      result.push(buildExternalInfo(project, folders, repoRoot, entry));
    }
  }
  return result;
}

async function externalInfoForPath(path: string, project: ProjectInfo | null): Promise<WorkspaceInfo | null> {
  if (!isAbsolute(path) || !(await exists(path))) return null;
  const repoRoot = await repoRootOf(path);
  if (!repoRoot) return null;
  const info = await gitHeadInfo(path).catch(() => ({ head: "", branch: null }));
  const entry = { path, head: info.head, branch: info.branch, isMain: false, prunable: false };
  // The worktree's own repository root is the checkout itself; the source
  // repository is the one whose git dir it shares. Find it through the
  // project when given, else treat the checkout as a single-root workspace.
  const folders = project ? orderedProjectFolders(project) : [path];
  let sourceRepo = repoRoot;
  if (project) {
    for (const folder of folders) {
      const candidate = await repoRootOf(folder);
      if (!candidate) continue;
      const list = await listRepoWorktrees(candidate).catch(() => []);
      if (list.some((w) => w.path === path)) { sourceRepo = candidate; break; }
    }
  }
  return buildExternalInfo(
    project ?? { id: "", name: "", source_folders: [path], primary_folder: path, created_at: 0, updated_at: 0 },
    folders,
    sourceRepo,
    entry,
  );
}

function buildExternalInfo(
  project: ProjectInfo,
  folders: string[],
  sourceRepo: string,
  entry: { path: string; head: string; branch: string | null },
): WorkspaceInfo {
  const roots: WorkspaceRoot[] = folders.map((folder) => {
    const rel = relative(sourceRepo, folder);
    const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    return inside
      ? { sourcePath: folder, effectivePath: rel ? join(entry.path, rel) : entry.path, worktreeIndex: 0 }
      : { sourcePath: folder, effectivePath: folder, worktreeIndex: -1 };
  });
  // Primary root must be one that lives in the checkout; otherwise the
  // session would run in the source folder while claiming the workspace.
  roots.sort((a, b) => (a.worktreeIndex === 0 ? 0 : 1) - (b.worktreeIndex === 0 ? 0 : 1));
  return {
    id: encodeExternalId(entry.path),
    project_id: project.id || null,
    name: entry.branch ?? entry.path.split(sep).pop() ?? entry.path,
    kind: "external",
    branch: entry.branch,
    roots,
    worktrees: [{ repoRoot: sourceRepo, path: entry.path, head: entry.head, branch: entry.branch }],
    created_by_session_id: null,
    created_at: 0,
    updated_at: 0,
  };
}

function mapRootsForSession(
  workspace: WorkspaceInfo,
  requested: string[],
): { cwd: string; additionalDirectories: string[] } {
  const bySource = new Map(workspace.roots.map((root) => [root.sourcePath, root.effectivePath]));
  const effective: string[] = [];
  for (const source of requested) {
    const mapped = bySource.get(source.trim());
    if (mapped && !effective.includes(mapped)) effective.push(mapped);
  }
  // Roots the caller did not name still belong to the workspace.
  for (const root of workspace.roots) {
    if (!effective.includes(root.effectivePath)) effective.push(root.effectivePath);
  }
  const [cwd, ...additionalDirectories] = effective;
  if (!cwd) throw new Error(`Workspace has no roots: ${workspace.id}`);
  return { cwd, additionalDirectories };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
