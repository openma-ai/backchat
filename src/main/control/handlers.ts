import { getProject } from "../sql-store.js";
import { workspaceService, type WorkspaceService } from "../workspace-service.js";
import { ControlError, asControlError } from "./errors.js";
import {
  listProjectRecords,
  saveProjectCommand,
  showProjectRecord,
} from "../project-commands.js";

export interface ControlApiDeps {
  workspaces?: WorkspaceService;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredString(params: Record<string, unknown>, key: string, label: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ControlError("invalid_args", `${label} is required`);
  }
  return value.trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function createControlApi(deps: ControlApiDeps = {}) {
  const workspaces = deps.workspaces ?? workspaceService;

  async function call(method: string, paramsValue: unknown): Promise<unknown> {
    const params = record(paramsValue);
    try {
      switch (method) {
        case "project.list":
          return listProjectRecords();
        case "project.show":
          return showProjectRecord(requiredString(params, "id", "Project id"));
        case "project.create":
          return saveProjectCommand({
            name: typeof params.name === "string" ? params.name : "",
            source_folders: stringList(params.sources ?? params.source_folders),
            primary_folder: typeof params.primary_folder === "string" ? params.primary_folder : undefined,
          });
        case "workspace.list": {
          const projectId = typeof params.project_id === "string" ? params.project_id.trim() : "";
          if (projectId && !getProject(projectId)) {
            throw new ControlError("not_found", `Project not found: ${projectId}`);
          }
          return workspaces.list(projectId || undefined);
        }
        case "workspace.show":
          return workspaces.show(requiredString(params, "id", "Workspace id"));
        case "workspace.create": {
          const projectId = requiredString(params, "project_id", "Project id");
          if (!getProject(projectId)) throw new ControlError("not_found", `Project not found: ${projectId}`);
          const branch = requiredString(params, "branch", "Branch");
          const base = typeof params.base === "string" ? params.base.trim() : "";
          return workspaces.create({
            project_id: projectId,
            name: branch,
            branch,
            ...(base ? { base_ref: base } : {}),
          });
        }
        case "workspace.remove": {
          const id = requiredString(params, "id", "Workspace id");
          const existing = await workspaces.resolve(id);
          if (!existing) throw new ControlError("not_found", `Workspace not found: ${id}`);
          await workspaces.delete(id, { force: params.force === true });
          return { id, removed: true };
        }
        default:
          throw new ControlError("invalid_args", `Unknown control method: ${method}`);
      }
    } catch (error) {
      throw asControlError(error);
    }
  }

  return { call };
}

export type ControlApi = ReturnType<typeof createControlApi>;
