export interface ProjectInfo {
  id: string;
  name: string;
  /** Ordered workspace roots. The primary folder is always first when set. */
  source_folders: string[];
  /** Default cwd for new chats, Git, and project instruction discovery. */
  primary_folder: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectSaveParams {
  project_id: string;
  name: string;
  source_folders: string[];
  primary_folder?: string;
}

/** Lexical folder form shared by every project path comparison: trimmed,
 *  without trailing separators (the filesystem root stays `/`). */
export function canonicalProjectFolder(folder: string): string {
  const trimmed = folder.trim();
  const stripped = trimmed.replace(/[\\/]+$/, "");
  return stripped || trimmed.slice(0, 1);
}

/** Identity of a project's folder set. Order-insensitive, so two projects
 *  that register the same directories share one key. `identify` lets the main
 *  process resolve symlinks and `~` before comparing. */
export function projectFolderSetKey(
  folders: readonly string[],
  identify: (folder: string) => string = canonicalProjectFolder,
): string {
  const keys = new Set(folders.map(canonicalProjectFolder).filter(Boolean).map(identify));
  return [...keys].sort().join("\0");
}

/** Collapses projects registered for the same folder set. The earliest-created
 *  record is the canonical one, so its id stays stable while duplicates are
 *  edited. Projects without folders have no folder identity and are kept. */
export function dedupeProjects(
  projects: readonly ProjectInfo[],
  keyOf: (project: ProjectInfo) => string,
): ProjectInfo[] {
  const canonical = new Map<string, ProjectInfo>();
  for (const project of projects) {
    const key = keyOf(project);
    const current = canonical.get(key);
    if (key && (!current || isOlderProject(project, current))) canonical.set(key, project);
  }
  return projects.filter((project) => {
    const key = keyOf(project);
    return !key || canonical.get(key) === project;
  });
}

function isOlderProject(a: ProjectInfo, b: ProjectInfo): boolean {
  return a.created_at !== b.created_at ? a.created_at < b.created_at : a.id < b.id;
}

export function normalizeProjectFolders(input: {
  source_folders: readonly string[];
  primary_folder?: string | null;
}): Pick<ProjectInfo, "source_folders" | "primary_folder"> {
  const folders: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.source_folders) {
    const folder = canonicalProjectFolder(raw);
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    folders.push(folder);
  }

  const requestedPrimary = canonicalProjectFolder(input.primary_folder ?? "");
  const primary = requestedPrimary && seen.has(requestedPrimary)
    ? requestedPrimary
    : folders[0] ?? "";

  return {
    primary_folder: primary,
    source_folders: primary
      ? [primary, ...folders.filter((folder) => folder !== primary)]
      : folders,
  };
}
