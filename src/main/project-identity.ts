import { realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { canonicalProjectFolder, projectFolderSetKey, type ProjectInfo } from "../shared/projects.js";

/** Expands a leading `~` to the user's home so `~/repo` and `/Users/me/repo`
 *  register the same folder. Other paths are returned unchanged. */
export function expandHomeFolder(folder: string): string {
  const trimmed = folder.trim();
  if (trimmed !== "~" && !/^~[\\/]/.test(trimmed)) return trimmed;
  return join(userInfo().homedir, trimmed.slice(1));
}

/** Filesystem identity of a folder: `~` expanded, symlinks resolved and, on
 *  case-insensitive volumes, the on-disk casing. Missing folders fall back to
 *  their lexical form so stale records still compare consistently. */
export function folderIdentity(folder: string): string {
  const expanded = canonicalProjectFolder(expandHomeFolder(folder));
  try {
    return realpathSync.native(expanded);
  } catch {
    return expanded;
  }
}

export function projectIdentityKey(folders: readonly string[]): string {
  return projectFolderSetKey(folders, folderIdentity);
}

/** For each path, the id of the first project with a source folder of the same
 *  filesystem identity. Paths no project owns are left out. */
export function folderProjectOwners(
  projects: readonly ProjectInfo[],
  paths: readonly string[],
): Record<string, string> {
  const owners = new Map<string, string>();
  for (const project of projects) {
    for (const folder of project.source_folders) {
      const identity = folderIdentity(folder);
      if (!owners.has(identity)) owners.set(identity, project.id);
    }
  }
  return Object.fromEntries(paths.flatMap((path) => {
    const owner = owners.get(folderIdentity(path));
    return owner ? [[path, owner]] : [];
  }));
}

/** The registered project that already owns exactly this folder set. */
export function findProjectByFolders(
  projects: readonly ProjectInfo[],
  folders: readonly string[],
): ProjectInfo | undefined {
  const wanted = projectIdentityKey(folders);
  return wanted ? projects.find((project) => projectIdentityKey(project.source_folders) === wanted) : undefined;
}
