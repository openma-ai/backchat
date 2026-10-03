import { randomBytes } from "node:crypto";
import { access, realpath } from "node:fs/promises";
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
  saveProject,
  setSessionWorkspace,
  type PersistedWorkspace,
} from "./sql-store.js";
import {
  defaultWorktreeStore,
  discoverWorkspaceSources,
  gitHeadInfo,
  listRepoWorktrees,
  repoRootOf,
  safeName,
  worktreeStatus,
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
 * Managed and linked workspaces are stored. Live derives from the project
 * and external checkout choices from `git worktree list`.
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
    checkouts?: Array<{ repoRoot: string; path: string }>;
    /** Use this branch in every source repo. Existing branches are checked out. */
    branch?: string;
    /** Start point for a new branch. Validated when the branch already exists. */
    base_ref?: string;
  }): Promise<WorkspaceInfo> {
    const name = input.name.trim();
    if (!name) throw new Error("Workspace name is required");
    const project = input.project_id ? getProject(input.project_id) : null;
    if (input.project_id && !project) {
      throw new Error(`Project not found: ${input.project_id}`);
    }
    const requestedDirectories = input.source_directories?.length
      ? input.source_directories
      : project
        ? orderedProjectFolders(project)
        : [];
    const discovered = await Promise.all(requestedDirectories.map(async (folder) => {
      const sources = await discoverWorkspaceSources(folder);
      if (!sources.length) throw new Error(`No Git repositories found in source folder: ${folder}`);
      return sources;
    }));
    const sourceDirectories = [...new Set(discovered.flat())];
    if (sourceDirectories.length === 0) {
      throw new Error("Workspace needs at least one source folder");
    }
    // Directory-based creation still needs a durable sidebar owner. Resolve
    // exact source folders, not a shared repository or a path prefix.
    const ensureProjectId = async (): Promise<string> => {
      if (project) return project.id;
      const folders = await Promise.all(requestedDirectories.map(folder => realpath(folder)));
      for (const candidate of listProjects()) {
        const existing = await Promise.all(candidate.source_folders.map(folder => realpath(folder).catch(() => folder)));
        if (existing.length === folders.length && folders.every(folder => existing.includes(folder))) return candidate.id;
      }
      return saveProject({
        id: `project-${randomBytes(8).toString("hex")}`,
        name: basename(folders[0]!),
        source_folders: folders,
        primary_folder: folders[0],
      }).id;
    };
    if (input.checkouts) {
      const worktrees: WorkspaceWorktree[] = [];
      const roots: WorkspaceRoot[] = [];
      const byRepo = new Map(input.checkouts.map(choice => [choice.repoRoot, choice.path]));
      if (byRepo.size !== input.checkouts.length) throw new Error("Choose one checkout per repository");
      for (const sourcePath of sourceDirectories) {
        const repoRoot = await repoRootOf(sourcePath);
        if (!repoRoot) throw new Error(`Repository not found: ${sourcePath}`);
        let index = worktrees.findIndex(tree => tree.repoRoot === repoRoot);
        if (index < 0) {
          const path = byRepo.get(repoRoot);
          const choices = await listRepoWorktrees(repoRoot);
          const choice = choices.find(choice => choice.path === path && !choice.prunable);
          if (!choice || !(await exists(choice.path))) throw new Error(`Checkout not available for ${repoRoot}`);
          index = worktrees.length;
          worktrees.push({ repoRoot, path: choice.path, head: choice.head, branch: choice.branch });
        }
        roots.push({ sourcePath, effectivePath: join(worktrees[index]!.path, relative(repoRoot, sourcePath)), worktreeIndex: index });
      }
      if (worktrees.length !== byRepo.size) throw new Error("Checkout does not belong to this project");
      const branches = new Set(worktrees.map(tree => tree.branch));
      return managedInfo(saveWorkspace({
        id: `ws-${safeName(name).toLowerCase().slice(0, 40)}-${randomBytes(4).toString("hex")}`,
        kind: "linked",
        project_id: await ensureProjectId(),
        name,
        branch: branches.size === 1 ? worktrees[0]!.branch : null,
        root_dir: "",
        source_directories: sourceDirectories,
        roots,
        worktrees,
        created_by_session_id: null,
      }));
    }
    if (project && input.branch?.trim()) {
      const branchName = input.branch.trim();
      const existing = listWorkspaceRows(project.id).find((row) =>
        row.kind === "managed" && row.branch === branchName
      );
      if (existing) {
        throw new Error(`Workspace already exists for branch ${branchName}: ${existing.id}`);
      }
    }
    const slug = safeName(name).toLowerCase().slice(0, 40);
    const suffix = randomBytes(2).toString("hex");
    const id = `ws-${slug}-${suffix}`;
    const branch = input.branch?.trim() || `backchat/${slug}-${suffix}`;
    const prepared = await this.#store.prepare({
      workspaceId: id,
      sourceDirectories,
      branch,
      ...(input.base_ref?.trim() ? { baseRef: input.base_ref.trim() } : {}),
    });
    const row = saveWorkspace({
      id,
      project_id: await ensureProjectId(),
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
  async list(projectId?: string, sourceDirectory?: string): Promise<WorkspaceInfo[]> {
    const projects = sourceDirectory && !projectId
      ? [{ id: "", name: basename(sourceDirectory), source_folders: [sourceDirectory], primary_folder: sourceDirectory, created_at: 0, updated_at: 0 }]
      : projectId
      ? [getProject(projectId)].filter((p): p is ProjectInfo => !!p)
      : listProjects();
    const expandedProjects = await Promise.all(projects.map(async (project) => {
      const discovered = await Promise.all(orderedProjectFolders(project).map(async (folder) => {
        const sources = await discoverWorkspaceSources(folder).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        // Non-Git roots still belong to live/external workspaces.
        return sources.length ? sources : [folder];
      }));
      const sources = [...new Set(discovered.flat())];
      return { ...project, source_folders: sources, primary_folder: sources[0] ?? "" };
    }));
    const scopedSources = new Set(expandedProjects.flatMap(p => p.source_folders));
    const managed = listWorkspaceRows(projectId).filter(row => !sourceDirectory || projectId || row.roots.some(root => (scopedSources.has(root.sourcePath) || scopedSources.has(root.effectivePath))));
    const managedPaths = new Set(
      managed.flatMap((row) => row.worktrees.map((w) => w.path)),
    );
    const result: WorkspaceInfo[] = [];
    for (const project of expandedProjects) {
      result.push(await liveInfo(project));
    }
    result.push(...managed.map(row => {
      const info = managedInfo(row);
      if (info.project_id) return info;
      const matches = expandedProjects.filter(project => project.id
        && project.source_folders.length === row.roots.length
        && project.source_folders.every(folder => row.roots.some(root => root.sourcePath === folder)));
      return matches.length === 1 ? { ...info, project_id: matches[0]!.id } : info;
    }));
    for (const project of expandedProjects) {
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
    if (row?.kind === "linked") {
      for (const tree of row.worktrees) {
        if (!(await exists(tree.path))) throw new Error(`Workspace checkout no longer exists: ${tree.path}`);
      }
    }
    if (!row) return null;
    if (!row.project_id) {
      const inferred = (await this.list()).find(workspace => workspace.id === id)?.project_id;
      if (inferred) return managedInfo(saveWorkspace({ ...row, project_id: inferred }));
    }
    return managedInfo(row);
  }

  /** Refusal checks only. Call this before stopping sessions so a rejected
   *  remove has no side effects. */
  async assertRemovable(id: string, options?: { force?: boolean }): Promise<void> {
    if (isLiveWorkspaceId(id)) throw new Error("The live workspace cannot be deleted");
    if (isExternalWorkspaceId(id)) {
      throw new Error("External worktrees are not managed by Backchat; remove them with git");
    }
    const row = getWorkspaceRow(id);
    if (!row) return;
    // The GUI keeps the historical force-remove. Callers that pass
    // `force: false` (the CLI) refuse dirty checkouts.
    if (options?.force === false && row.kind !== "linked") {
      for (const tree of row.worktrees) {
        const status = await worktreeStatus(tree.path).catch(() => null);
        if (status?.dirty) {
          throw new Error(
            `Workspace ${id} has uncommitted changes in ${tree.path}. Re-run with --force to remove it.`,
          );
        }
      }
    }
  }

  async delete(id: string, options?: { force?: boolean }): Promise<void> {
    await this.assertRemovable(id, options);
    const row = getWorkspaceRow(id);
    if (!row) return;
    if (row.kind !== "linked") await this.#store.removeDir(row.root_dir);
    deleteWorkspaceRow(id);
  }

  /** Refresh each checkout's branch, HEAD, and dirty state from git. */
  async show(id: string): Promise<WorkspaceInfo & {
    repos: Array<{
      repo_root: string;
      path: string;
      branch: string | null;
      head: string;
      dirty: boolean;
    }>;
  }> {
    const info = await this.resolve(id);
    if (!info) throw new Error(`Workspace not found: ${id}`);
    const repos = await Promise.all(info.worktrees.map(async (tree) => {
      const live = await worktreeStatus(tree.path).catch(() => null);
      return {
        repo_root: tree.repoRoot,
        path: tree.path,
        branch: live?.branch ?? tree.branch,
        head: live?.head || tree.head,
        dirty: live?.dirty ?? false,
      };
    }));
    return { ...info, repos };
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
  projectId: string | null;
  cwd: string;
  additionalDirectories: string[];
  created: boolean;
}> {
  if (input.workspaceId) {
    const workspace = await workspaceService.resolve(input.workspaceId, input.projectId);
    if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);
    if (input.projectId && workspace.project_id && input.projectId !== workspace.project_id) {
      throw new Error("Workspace does not belong to the selected project");
    }
    const mapped = mapRootsForSession(workspace, input.sourceDirectories);
    return {
      workspaceId: workspace.kind === "live" ? null : workspace.id,
      projectId: workspace.project_id ?? input.projectId,
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
  return { workspaceId: workspace.id, projectId: workspace.project_id, ...mapRootsForSession(workspace, input.sourceDirectories), created: true };
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
    kind: row.kind,
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
