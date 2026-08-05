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

export function normalizeProjectFolders(input: {
  source_folders: readonly string[];
  primary_folder?: string | null;
}): Pick<ProjectInfo, "source_folders" | "primary_folder"> {
  const folders: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.source_folders) {
    const folder = raw.trim();
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    folders.push(folder);
  }

  const requestedPrimary = input.primary_folder?.trim() ?? "";
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
