import { isPerSessionFolderPath } from "./project-path";

export function selectRecentProjectPaths(
  rows: readonly { cwd?: string | null }[],
  limit = 8,
): string[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const row of rows) {
    const cwd = row.cwd?.trim();
    if (!cwd || seen.has(cwd) || isPerSessionFolderPath(cwd)) continue;
    seen.add(cwd);
    paths.push(cwd);
    if (paths.length >= limit) break;
  }
  return paths;
}
