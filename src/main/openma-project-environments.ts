import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, parse } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProjectInfo } from "../shared/projects.js";
import type { OpenmaProjectBinding, OpenmaScope } from "../shared/openma.js";
import { openmaDesktopTaskId, openmaRunnerSessionId } from "./openma-identity.js";

export interface OpenmaRunnerSession extends OpenmaScope {
  sessionId: string; localSessionId: string; taskId: string;
  runtimeId: string; environmentId: string; agentId: string;
  projectId: string; cwd: string; additionalDirectories: string[];
}

function scopeKey(scope: OpenmaScope): string {
  if (!scope.baseUrl || !scope.userId || !scope.workspaceId) throw new Error("Choose an OpenMA workspace");
  return JSON.stringify([scope.baseUrl.replace(/\/$/, ""), scope.userId, scope.workspaceId]);
}

/** Local consent to run a particular environment inside a named project.
 * Paths are resolved from the current project, never from an incoming task. */
export class OpenmaProjectEnvironments {
  #db: DatabaseSync;
  #project: (id: string) => ProjectInfo | null;
  constructor(path: string, project: (id: string) => ProjectInfo | null) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#project = project;
    this.#db.exec(`CREATE TABLE IF NOT EXISTS project_environments (
      scope TEXT NOT NULL, environment_id TEXT NOT NULL, runtime_id TEXT NOT NULL,
      project_id TEXT NOT NULL, PRIMARY KEY (scope, environment_id, runtime_id)
    )`);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS runner_session_workspaces (
      scope TEXT NOT NULL, session_id TEXT NOT NULL, runtime_id TEXT NOT NULL,
      environment_id TEXT NOT NULL, workspace TEXT NOT NULL, PRIMARY KEY(scope, session_id)
    )`);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS runner_sessions (
      local_id TEXT PRIMARY KEY, scope TEXT NOT NULL, session_id TEXT NOT NULL,
      data TEXT NOT NULL, UNIQUE(scope, session_id)
    )`);
  }

  #roots(projectId: string) {
    const project = this.#project(projectId);
    if (!project) throw new Error("The linked project is no longer available");
    const roots = [...new Set([project.primary_folder, ...project.source_folders])];
    if (roots.some((root) => !root || !isAbsolute(root) || parse(root).root === root)) {
      throw new Error("Choose explicit project directories before linking this environment");
    }
    return { projectId, cwd: roots[0]!, additionalDirectories: roots.slice(1) };
  }

  link(scope: OpenmaScope, binding: OpenmaProjectBinding): void {
    this.validate(binding);
    this.#db.prepare(`INSERT INTO project_environments VALUES (?, ?, ?, ?)
      ON CONFLICT(scope, environment_id, runtime_id) DO UPDATE SET project_id = excluded.project_id`)
      .run(scopeKey(scope), binding.environmentId, binding.runtimeId ?? "", binding.projectId);
  }

  validate(binding: OpenmaProjectBinding): void {
    if (!binding.environmentId || !binding.projectId || binding.runtimeId === "") throw new Error("Choose a project and environment");
    if (binding.runtimeId !== null) this.#roots(binding.projectId);
    else if (!this.#project(binding.projectId)) throw new Error("The project is no longer available");
  }

  resolve(scope: OpenmaScope, runtimeId: string, environmentId: string) {
    if (!runtimeId) throw new Error("This environment has no linked project on this runner");
    const row = this.#db.prepare("SELECT project_id FROM project_environments WHERE scope = ? AND environment_id = ? AND runtime_id = ?")
      .get(scopeKey(scope), environmentId, runtimeId) as { project_id: string } | undefined;
    if (!row) throw new Error("This environment has no linked project on this runner");
    return this.#roots(row.project_id);
  }

  resolveSession(scope: OpenmaScope, runtimeId: string, environmentId: string, sessionId: string) {
    const key = scopeKey(scope);
    const pinned = this.#db.prepare("SELECT runtime_id, environment_id, workspace FROM runner_session_workspaces WHERE scope = ? AND session_id = ?")
      .get(key, sessionId) as { runtime_id: string; environment_id: string; workspace: string } | undefined;
    if (pinned) {
      if (pinned.runtime_id !== runtimeId || pinned.environment_id !== environmentId) throw new Error("A task's environment cannot change");
      return JSON.parse(pinned.workspace) as { projectId: string; cwd: string; additionalDirectories: string[] };
    }
    const workspace = this.resolve(scope, runtimeId, environmentId);
    this.#db.prepare("INSERT INTO runner_session_workspaces VALUES (?, ?, ?, ?, ?)").run(key, sessionId, runtimeId, environmentId, JSON.stringify(workspace));
    return workspace;
  }

  /** Persist before starting the host so ready/output broadcasts can be routed
   * immediately, and remain recognizable after logout or a process restart. */
  resolveRunnerSession(scope: OpenmaScope, runtimeId: string, environmentId: string, sessionId: string, agentId: string): OpenmaRunnerSession {
    const normalized = { ...scope, baseUrl: scope.baseUrl.replace(/\/$/, "") };
    scopeKey(normalized);
    if (!sessionId || !agentId) throw new Error("OpenMA task identity is incomplete");
    const localSessionId = openmaRunnerSessionId(normalized, sessionId);
    const previous = this.runnerSession(localSessionId);
    if (previous) {
      if (previous.environmentId !== environmentId || previous.runtimeId !== runtimeId) throw new Error("A task's environment cannot change");
      if (previous.agentId !== agentId) throw new Error("A task's execution agent cannot change");
      return previous;
    }
    const workspace = this.resolveSession(normalized, runtimeId, environmentId, sessionId);
    const association = { ...normalized, ...workspace, sessionId, localSessionId, taskId: openmaDesktopTaskId(normalized, sessionId), runtimeId, environmentId, agentId };
    this.#db.prepare("INSERT INTO runner_sessions VALUES (?, ?, ?, ?)").run(localSessionId, scopeKey(normalized), sessionId, JSON.stringify(association));
    return association;
  }

  runnerSession(localSessionId: string): OpenmaRunnerSession | null {
    const row = this.#db.prepare("SELECT data FROM runner_sessions WHERE local_id = ?").get(localSessionId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as OpenmaRunnerSession : null;
  }

  list(scope: OpenmaScope, projectId?: string): OpenmaProjectBinding[] {
    const rows = this.#db.prepare(`SELECT project_id, environment_id, runtime_id FROM project_environments
      WHERE scope = ? AND (? IS NULL OR project_id = ?) ORDER BY environment_id, runtime_id`)
      .all(scopeKey(scope), projectId ?? null, projectId ?? null) as Array<{ project_id: string; environment_id: string; runtime_id: string }>;
    return rows.map((row) => ({ projectId: row.project_id, environmentId: row.environment_id, runtimeId: row.runtime_id || null }));
  }

  unlink(scope: OpenmaScope, environmentId: string, runtimeId: string | null): void {
    this.#db.prepare("DELETE FROM project_environments WHERE scope = ? AND environment_id = ? AND runtime_id = ?")
      .run(scopeKey(scope), environmentId, runtimeId ?? "");
  }
  close(): void { this.#db.close(); }
}
