import { isPerSessionFolderPath } from "./project-path";

export function selectRecentProjectPaths(
  rows: readonly { cwd?: string | null; workspace_id?: string | null }[],
  limit = 8,
): string[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const row of rows) {
    const cwd = row.cwd?.trim();
    // A session inside a workspace ran in a checkout (…/worktrees/<ws>/01-repo),
    // which is not a project folder anyone would pick again.
    if (!cwd || row.workspace_id || seen.has(cwd) || isPerSessionFolderPath(cwd)) continue;
    seen.add(cwd);
    paths.push(cwd);
    if (paths.length >= limit) break;
  }
  return paths;
}
