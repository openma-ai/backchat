export function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

export function folderName(path: string): string {
  const parts = pathSegments(path);
  return parts.at(-1) ?? path;
}

export function isPerSessionFolderPath(path: string): boolean {
  const parts = pathSegments(path);
  if (parts.length < 2) return false;
  const folder = parts.at(-1) ?? "";
  const parent = parts.at(-2) ?? "";
  return parent === "sessions" && folder.startsWith("sess-");
}

export function projectKeyForCwd(cwd: string | null | undefined): string | null {
  const path = cwd?.trim();
  if (!path || isPerSessionFolderPath(path)) return null;
  return path;
}
