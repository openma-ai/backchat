/** Project → Workspace → Worktree.
 *
 *  A workspace is one set of checkouts a session works in. Sessions attach
 *  to a workspace, never to a single worktree, because a project can span
 *  several repositories and the agent needs all of its roots at once.
 *
 *  - live:     the project's source folders themselves. Every project has
 *              exactly one; it is derived, never stored, and its id is
 *              `live:<projectId>`.
 *  - managed:  git worktrees Backchat created under its own directory.
 *              Persisted, shared by any number of sessions, deleted only
 *              explicitly.
 *  - linked:   a saved combination of existing checkouts; deleting it only
 *              removes the reference, never the worktrees.
 *  - external: worktrees found through `git worktree list` that Backchat did
 *              not create (codex, manual). Read-only adoption: sessions may
 *              run there, Backchat never removes them. Id is
 *              `ext:<base64url(path)>`.
 */
export type WorkspaceKind = "live" | "managed" | "linked" | "external";

export interface WorkspaceWorktree {
  /** Canonical top level of the source repository. */
  repoRoot: string;
  /** Checkout directory the session sees. Equals repoRoot for live. */
  path: string;
  head: string;
  /** Branch name, or null when the checkout is detached. */
  branch: string | null;
}

export interface GitChange {
  path: string;
  status: string;
}

export interface GitReview {
  kind: "PR" | "MR";
  number: number;
  url: string;
  title: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  checks: "unknown" | "pending" | "passed" | "failed";
  review: "unknown" | "required" | "approved" | "changes_requested";
}

export interface GitEnvironment {
  cwd: string;
  head: string;
  branch: string | null;
  remote?: string;
  changes: GitChange[];
  insertions: number;
  deletions: number;
}

export interface GitComparison {
  baseBranch: string;
  headBranch: string;
  files: Array<{ path: string; insertions: number; deletions: number }>;
  insertions: number;
  deletions: number;
}

export interface WorkspaceRoot {
  /** Project source folder this root stands in for. */
  sourcePath: string;
  /** Directory handed to the agent (cwd or additional directory). */
  effectivePath: string;
  worktreeIndex: number;
}

export interface WorkspaceInfo {
  id: string;
  project_id: string | null;
  name: string;
  kind: WorkspaceKind;
  branch: string | null;
  roots: WorkspaceRoot[];
  worktrees: WorkspaceWorktree[];
  created_by_session_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface WorkspaceCreateParams {
  project_id?: string;
  /** Folder selected directly, without a saved project. */
  source_directory?: string;
  /** Save a reusable combination without creating or owning these checkouts. */
  checkouts?: Array<{ repoRoot: string; path: string }>;
  name: string;
}

export const LIVE_WORKSPACE_PREFIX = "live:";
export const EXTERNAL_WORKSPACE_PREFIX = "ext:";

export function liveWorkspaceId(projectId: string): string {
  return `${LIVE_WORKSPACE_PREFIX}${projectId}`;
}

export function isLiveWorkspaceId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(LIVE_WORKSPACE_PREFIX);
}

export function isExternalWorkspaceId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(EXTERNAL_WORKSPACE_PREFIX);
}

/** Session-facing workspace reference: null/live means "work in the source
 *  folders", anything else is a stored or adopted checkout set. */
export function persistedWorkspaceId(id: string | null | undefined): string | null {
  return id && !isLiveWorkspaceId(id) ? id : null;
}
