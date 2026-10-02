import { randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ProjectInfo } from "../shared/projects.js";
import { getProject, listProjects, saveProject } from "./sql-store.js";
import { ControlError } from "./control/errors.js";

export function listProjectRecords(): ProjectInfo[] {
  return listProjects();
}

export function showProjectRecord(id: string): ProjectInfo {
  const project = getProject(id);
  if (!project) throw new ControlError("not_found", `Project not found: ${id}`);
  return project;
}

/** Same validation the project IPC handler uses. The CLI may omit an id. */
export function saveProjectCommand(input: {
  project_id?: string;
  name?: string;
  source_folders?: readonly string[];
  primary_folder?: string;
  requireId?: boolean;
}): ProjectInfo & { created: boolean } {
  const projectId = input.project_id?.trim() ?? "";
  if (input.requireId && !projectId) {
    throw new ControlError("invalid_args", "Project id is required");
  }
  const name = input.name?.trim() ?? "";
  if (!name) throw new ControlError("invalid_args", "Project name is required");
  const sourceFolders = (input.source_folders ?? []).map((folder) => folder.trim()).filter(Boolean);
  if (!input.requireId && sourceFolders.length === 0) {
    throw new ControlError("invalid_args", "A project needs at least one source directory");
  }
  const invalidFolder = sourceFolders.find((folder) => !isAbsolute(folder));
  if (invalidFolder) {
    throw new ControlError("invalid_args", `Project source folders must be absolute: ${invalidFolder}`);
  }
  const missing = sourceFolders.find((folder) => !existsSync(folder));
  if (missing) {
    throw new ControlError("invalid_args", `Source directory does not exist: ${missing}`);
  }
  const wanted = folderKey(sourceFolders);
  if (!projectId) {
    const match = listProjects().find((project) =>
      project.name === name && folderKey(project.source_folders) === wanted
    );
    if (match) return { ...match, created: false };
  }
  return {
    ...saveProject({
      id: projectId || `project-${randomBytes(8).toString("hex")}`,
      name,
      source_folders: sourceFolders,
      primary_folder: input.primary_folder,
    }),
    created: true,
  };
}

function folderKey(folders: readonly string[]): string {
  return [...folders].map((folder) => {
    try {
      return realpathSync(folder);
    } catch {
      return folder;
    }
  }).sort().join("\0");
}
