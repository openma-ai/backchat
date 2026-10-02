import { randomUUID } from "node:crypto";
import type { ProjectWorkCommand, ProjectWorkGoalInput } from "../../shared/project-work.js";
import { deleteProject } from "../sql-store.js";
import {
  appendExternalTaskNote,
  ensureExternalCoordinator,
  getExternalTask,
  getProject,
  getSession,
  insertExternalTask,
  listExternalCoordinators,
  listExternalTaskNotes,
  listExternalTasks,
  listSessions,
  listSessionsForProjectRemoval,
  loadHistory,
  setExternalTaskStatus,
} from "../sql-store.js";
import type { ExternalTaskInfo } from "../../shared/external-coordinator.js";
import { workspaceService, type WorkspaceService } from "../workspace-service.js";
import type { SessionManager } from "../session-manager.js";
import { listPendingAsks, respondToBrokerAsk } from "../brokers.js";
import { isSessionPermissionPolicy } from "../permission-policy.js";
import { ControlError, asControlError } from "./errors.js";
import {
  listProjectRecords,
  saveProjectCommand,
  showProjectRecord,
} from "../project-commands.js";
import { ControlStream, subscribeControlLiveEvents } from "./live-bus.js";
import { sessionTurnSummary, transcriptFromHistory } from "./transcript.js";

export interface ControlWorkApi {
  submit(input: ProjectWorkCommand): Promise<void>;
  view(id: string): Promise<unknown>;
  goal(input: ProjectWorkGoalInput): Promise<unknown>;
}

export interface ControlApiDeps {
  workspaces?: WorkspaceService;
  sessions?: SessionManager;
  work?: ControlWorkApi;
  onProjectsChanged?: () => void;
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

  async function call(method: string, paramsValue: unknown, client?: string): Promise<unknown> {
    const params = record(paramsValue);
    try {
      switch (method) {
        case "project.list":
          return listProjectRecords();
        case "project.show":
          return showProjectRecord(requiredString(params, "id", "Project id"));
        case "project.create": {
          const created = saveProjectCommand({
            name: typeof params.name === "string" ? params.name : "",
            source_folders: stringList(params.sources ?? params.source_folders),
            primary_folder: typeof params.primary_folder === "string" ? params.primary_folder : undefined,
          });
          deps.onProjectsChanged?.();
          return created;
        }
        case "project.remove":
          return removeProject(workspaces, deps.sessions, params, deps.onProjectsChanged);
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
        case "session.list":
          return listSessionRecords(params, client);
        case "session.start":
          return startSession(deps.sessions, workspaces, params, client);
        case "session.send":
          return sendSession(deps.sessions, params);
        case "session.status":
          return sessionStatus(deps.sessions, requiredString(params, "id", "Session id"));
        case "session.transcript":
          return sessionTranscript(params);
        case "session.cancel":
          return cancelSession(deps.sessions, requiredString(params, "id", "Session id"));
        case "session.pending":
          return { requests: listPendingAsks(requiredString(params, "id", "Session id")) };
        case "session.respond":
          await respondToBrokerAsk(
            requiredString(params, "id", "Session id"),
            requiredString(params, "request_id", "Request id"),
            requiredString(params, "option", "Option"),
          );
          return { ok: true };
        case "work.submit":
          return submitWork(deps.work, params, client);
        case "work.list":
          return listClientWork(params, client);
        case "work.status":
          return workStatus(deps.work, params, client);
        case "work.steer":
          return steerWork(params, client);
        case "work.cancel":
          return cancelWork(params, client);
        case "work.transcript":
          return taskTranscript(params, client);
        case "work.view": {
          if (typeof params.task_id === "string" && params.task_id.trim()) {
            return taskRecord(requireOwnedTask(params, client).id);
          }
          const projectId = requiredString(params, "project_id", "Project id");
          if (!getProject(projectId)) throw new ControlError("not_found", `Project not found: ${projectId}`);
          const view = withExternalWork(projectId, await requireWork(deps.work).view(projectId));
          const caller = clientName(params, client);
          if (!caller) return view;
          return {
            ...view,
            external_tasks: (view.external_tasks ?? []).filter((task) => task.coordinator_name === caller),
          };
        }
        case "work.goal":
          return requireWork(deps.work).goal(goalInput(params));
        default:
          throw new ControlError("invalid_args", `Unknown control method: ${method}`);
      }
    } catch (error) {
      throw asControlError(error);
    }
  }

  return { call };
}

function listSessionRecords(params: Record<string, unknown>, client?: string) {
  const projectId = typeof params.project_id === "string" ? params.project_id.trim() : "";
  const workspaceId = typeof params.workspace_id === "string" ? params.workspace_id.trim() : "";
  const caller = clientName(params, client);
  return listSessions(500)
    .filter((session) => !projectId || session.project_id === projectId)
    .filter((session) => !workspaceId || session.workspace_id === workspaceId)
    .filter((session) => !caller || session.external_client === caller)
    .map((session) => ({
      id: session.id,
      title: session.title,
      agent_id: session.agent_id,
      cwd: session.cwd,
      project_id: session.project_id,
      workspace_id: session.workspace_id,
      external_client: session.external_client,
      acp_session_id: session.acp_session_id,
      created_at: session.created_at,
      last_used_at: session.last_used_at,
    }));
}

function clientName(params: Record<string, unknown>, client?: string): string {
  const fromParams = typeof params.client === "string" ? params.client.trim() : "";
  return fromParams || client?.trim() || "";
}

function requireOwnedTask(params: Record<string, unknown>, client?: string) {
  const taskId = requiredString(params, "task_id", "Task id");
  const task = getExternalTask(taskId);
  if (!task) throw new ControlError("not_found", `Task not found: ${taskId}`);
  const projectId = typeof params.project_id === "string" ? params.project_id.trim() : "";
  if (projectId && task.project_id !== projectId) {
    throw new ControlError("not_found", `Task not found: ${taskId}`);
  }
  const caller = clientName(params, client);
  if (caller && task.coordinator_name !== caller) {
    throw new ControlError("not_found", `Task not found: ${taskId}`);
  }
  return task;
}

function taskRecord(taskId: string) {
  const task = getExternalTask(taskId);
  if (!task) throw new ControlError("not_found", `Task not found: ${taskId}`);
  return { ...task, notes: listExternalTaskNotes(task.id) };
}

function listClientWork(params: Record<string, unknown>, client?: string) {
  const projectId = typeof params.project_id === "string" ? params.project_id.trim()
    : typeof params.id === "string" ? params.id.trim() : "";
  if (projectId && !getProject(projectId)) throw new ControlError("not_found", `Project not found: ${projectId}`);
  const caller = clientName(params, client);
  return {
    project_id: projectId || null,
    client: caller || null,
    tasks: listExternalTasks(projectId || undefined, caller || undefined).map((task) => ({
      ...task,
      notes: listExternalTaskNotes(task.id),
    })),
  };
}

function steerWork(params: Record<string, unknown>, client?: string) {
  const task = requireOwnedTask(params, client);
  if (task.status === "cancelled") {
    throw new ControlError("invalid_args", `Task ${task.id} is cancelled`);
  }
  const text = requiredString(params, "text", "Text");
  const note = appendExternalTaskNote(task.id, "steer", text);
  return { ...taskRecord(task.id), note };
}

function cancelWork(params: Record<string, unknown>, client?: string) {
  const task = requireOwnedTask(params, client);
  const text = typeof params.text === "string" && params.text.trim() ? params.text.trim() : "cancelled";
  setExternalTaskStatus(task.id, "cancelled");
  appendExternalTaskNote(task.id, "cancel", text);
  return { ...taskRecord(task.id), cancelled: true };
}

function taskTranscript(params: Record<string, unknown>, client?: string) {
  const task = requireOwnedTask(params, client);
  const notes = listExternalTaskNotes(task.id);
  return {
    task_id: task.id,
    project_id: task.project_id,
    client: task.coordinator_name,
    status: task.status,
    events: [
      { cursor: "0", role: "user", type: "text", text: task.text, timestamp: new Date(task.created_at).toISOString() },
      ...notes.map((note) => ({
        cursor: String(note.id),
        role: note.kind === "steer" ? "user" as const : "system" as const,
        type: note.kind === "cancel" ? "status" as const : "text" as const,
        status: note.kind === "cancel" ? "cancelled" : undefined,
        text: note.text,
        timestamp: new Date(note.created_at).toISOString(),
      })),
    ],
  };
}

async function startSession(
  sessions: SessionManager | undefined,
  workspaces: WorkspaceService,
  params: Record<string, unknown>,
  client?: string,
) {
  const manager = requireSessions(sessions);
  const agentId = requiredString(params, "agent_id", "Agent id");
  const workspaceId = typeof params.workspace_id === "string" ? params.workspace_id.trim() : "";
  const root = typeof params.root === "string" ? params.root.trim() : "";
  const directories = stringList(params.directories);
  const prompt = typeof params.prompt === "string" ? params.prompt : "";
  const approve = params.approve;
  if (approve !== undefined && !isSessionPermissionPolicy(approve)) {
    throw new ControlError("invalid_args", "--approve must be ask, auto-read, auto-edit, or auto-all");
  }
  if (!workspaceId && !root) {
    throw new ControlError("invalid_args", "session start needs --workspace or --root");
  }
  let projectId = typeof params.project_id === "string" ? params.project_id.trim() : "";
  if (!projectId && workspaceId) {
    projectId = (await workspaces.resolve(workspaceId))?.project_id ?? "";
  }
  if (client && projectId) {
    if (!getProject(projectId)) throw new ControlError("not_found", `Project not found: ${projectId}`);
    ensureExternalCoordinator(projectId, client);
  }
  const sessionId = `sess-${randomUUID().slice(0, 8)}`;
  const started = await manager.start({
    session_id: sessionId,
    agent_id: agentId,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    ...(root ? { cwd: root } : {}),
    ...(directories.length
      ? workspaceId
        ? { extra_directories: directories }
        : { additional_directories: directories }
      : {}),
    ...(projectId ? { project_id: projectId } : {}),
    ...(client ? { external_client: client } : {}),
    ...(isSessionPermissionPolicy(approve) ? { permission_policy: approve } : {}),
  });
  if (started.status === "error") {
    if (/unknown ACP agent/i.test(started.message)) {
      throw new ControlError("invalid_args", started.message);
    }
    throw new ControlError("error", started.message);
  }
  if (started.status !== "ready") throw new ControlError("error", "Session start was cancelled");
  let turnId: string | undefined;
  if (prompt.trim()) {
    turnId = randomUUID();
    void manager.prompt({ session_id: sessionId, turn_id: turnId, text: prompt }).catch(() => undefined);
  }
  return { ...started, turn_id: turnId ?? null, external_client: client ?? null };
}

async function sendSession(sessions: SessionManager | undefined, params: Record<string, unknown>) {
  const manager = requireSessions(sessions);
  const id = requiredString(params, "id", "Session id");
  const message = requiredString(params, "message", "Message");
  if (!getSession(id)) throw new ControlError("not_found", `Session not found: ${id}`);
  const wait = params.wait === true;
  const stream = params.stream === true;
  const timeoutSec = timeoutSeconds(params.timeout);
  if (timeoutSec !== undefined && !wait && !stream) {
    throw new ControlError("invalid_args", "--timeout requires --wait or --stream");
  }
  const turnId = randomUUID();
  const startPrompt = () => manager.prompt({ session_id: id, turn_id: turnId, text: message });
  if (stream) {
    return new ControlStream(streamTurn(id, turnId, startPrompt, timeoutSec));
  }
  const prompt = startPrompt();
  if (!wait) {
    void prompt.catch(() => undefined);
    return { session_id: id, turn_id: turnId, accepted: true, state: "running" };
  }
  const timedOut = await waitFor(prompt, timeoutSec);
  const status = await sessionStatus(manager, id);
  if (timedOut) {
    throw new ControlError("timeout", `Timed out after ${timeoutSec}s`, {
      session_id: id,
      turn_id: turnId,
      state: "timeout",
      status,
    });
  }
  return {
    session_id: id,
    turn_id: turnId,
    state: "complete",
    reply: status.last_reply ?? "",
    status,
  };
}

async function* streamTurn(
  sessionId: string,
  turnId: string,
  start: () => Promise<void>,
  timeoutSec: number | undefined,
): AsyncIterable<import("./live-bus.js").ControlLiveEvent> {
  const queue: import("./live-bus.js").ControlLiveEvent[] = [];
  let notify: (() => void) | undefined;
  const unsubscribe = subscribeControlLiveEvents((event) => {
    if (event.session_id !== sessionId) return;
    queue.push(event);
    notify?.();
  });
  const prompt = start();
  let finished = false;
  let failed: unknown;
  void prompt.then(() => {
    finished = true;
    notify?.();
  }, (error) => {
    failed = error;
    finished = true;
    notify?.();
  });
  const deadline = timeoutSec === undefined ? undefined : Date.now() + timeoutSec * 1000;
  try {
    while (!finished || queue.length > 0) {
      if (queue.length === 0) {
        const remaining = deadline === undefined ? undefined : deadline - Date.now();
        if (remaining !== undefined && remaining <= 0) break;
        await new Promise<void>((resolve) => {
          notify = resolve;
          if (remaining !== undefined) setTimeout(resolve, remaining);
        });
        notify = undefined;
        if (deadline !== undefined && Date.now() >= deadline && queue.length === 0 && !finished) break;
        continue;
      }
      yield queue.shift()!;
    }
  } finally {
    unsubscribe();
  }
  if (deadline !== undefined && !finished) {
    yield {
      type: "result",
      session_id: sessionId,
      turn_id: turnId,
      status: "timeout",
      timestamp: new Date().toISOString(),
    };
    return;
  }
  if (failed) {
    yield {
      type: "result",
      session_id: sessionId,
      turn_id: turnId,
      status: "error",
      message: failed instanceof Error ? failed.message : String(failed),
      timestamp: new Date().toISOString(),
    };
  }
}

async function sessionStatus(sessions: SessionManager | undefined, id: string) {
  const row = getSession(id);
  if (!row) throw new ControlError("not_found", `Session not found: ${id}`);
  const runtime = sessions ? await sessions.getRuntimeStatus(id) : null;
  const summary = sessionTurnSummary(loadHistory(id));
  const busy = runtime?.busy ?? false;
  return {
    id: row.id,
    title: row.title,
    agent_id: row.agent_id,
    cwd: row.cwd,
    project_id: row.project_id,
    workspace_id: row.workspace_id,
    external_client: row.external_client,
    acp_session_id: row.acp_session_id,
    running: sessions?.has(id) ?? false,
    busy,
    active_turn_ids: sessions?.activeTurnIds(id) ?? [],
    last_outcome: busy ? "running" : summary.outcome,
    ...(summary.reply ? { last_reply: summary.reply } : {}),
  };
}

function sessionTranscript(params: Record<string, unknown>) {
  const id = requiredString(params, "id", "Session id");
  if (!getSession(id)) throw new ControlError("not_found", `Session not found: ${id}`);
  const since = typeof params.since === "string" ? params.since : undefined;
  try {
    return { session_id: id, events: transcriptFromHistory(loadHistory(id), since) };
  } catch (error) {
    throw new ControlError("invalid_args", error instanceof Error ? error.message : String(error));
  }
}

function cancelSession(sessions: SessionManager | undefined, id: string) {
  if (!getSession(id)) throw new ControlError("not_found", `Session not found: ${id}`);
  const manager = requireSessions(sessions);
  const turnIds = manager.activeTurnIds(id);
  for (const turnId of turnIds) manager.cancel(id, turnId);
  return { id, cancelled: turnIds.length > 0, turn_ids: turnIds };
}

async function submitWork(work: ControlWorkApi | undefined, params: Record<string, unknown>, client?: string) {
  const api = requireWork(work);
  const projectId = requiredString(params, "project_id", "Project id");
  if (!getProject(projectId)) throw new ControlError("not_found", `Project not found: ${projectId}`);
  const type = typeof params.type === "string" ? params.type : "message";
  if (type !== "message" && type !== "delegate" && type !== "steer" && type !== "cancel" && type !== "complete") {
    throw new ControlError("invalid_args", `Unknown work command: ${type}`);
  }
  const text = typeof params.text === "string" ? params.text : "";
  if (!text.trim()) throw new ControlError("invalid_args", "Work text is required");
  const command: ProjectWorkCommand = {
    projectId,
    commandId: typeof params.command_id === "string" && params.command_id.trim()
      ? params.command_id.trim()
      : randomUUID(),
    type,
    text,
    ...(typeof params.worker_id === "string" && params.worker_id.trim() ? { workerId: params.worker_id.trim() } : {}),
    ...(typeof params.run_id === "string" && params.run_id.trim() ? { runId: params.run_id.trim() } : {}),
  };
  if (client) {
    const coordinator = ensureExternalCoordinator(projectId, client);
    const task = insertExternalTask({
      projectId,
      coordinator,
      commandId: command.commandId,
      type,
      text,
      ...(command.workerId ? { workerId: command.workerId } : {}),
    });
    return {
      project_id: projectId,
      command_id: command.commandId,
      external_coordinator: coordinator.name,
      routed: "external" as const,
      task,
    };
  }
  await api.submit(command);
  return {
    project_id: projectId,
    command_id: command.commandId,
    external_coordinator: null,
    routed: "builtin" as const,
  };
}

async function workStatus(work: ControlWorkApi | undefined, params: Record<string, unknown>, client?: string) {
  if (clientName(params, client)) return listClientWork(params, client);
  const api = requireWork(work);
  const projectId = typeof params.project_id === "string" ? params.project_id.trim()
    : typeof params.id === "string" ? params.id.trim() : "";
  if (!projectId) {
    return listProjectRecords().map((project) => ({
      id: project.id,
      name: project.name,
      external_coordinators: listExternalCoordinators(project.id),
    }));
  }
  if (!getProject(projectId)) throw new ControlError("not_found", `Project not found: ${projectId}`);
  return withExternalWork(projectId, await api.view(projectId));
}

export function withExternalWork<T>(projectId: string, view: T): T & {
  external_coordinators: ReturnType<typeof listExternalCoordinators>;
  external_tasks: ExternalTaskInfo[];
} {
  return {
    ...view,
    external_coordinators: listExternalCoordinators(projectId),
    external_tasks: listExternalTasks(projectId),
  };
}

function goalInput(params: Record<string, unknown>): ProjectWorkGoalInput {
  const status = params.status;
  if (status !== undefined && status !== "active" && status !== "paused") {
    throw new ControlError("invalid_args", "--status must be active or paused");
  }
  return {
    projectId: requiredString(params, "project_id", "Project id"),
    workThreadId: requiredString(params, "thread_id", "Work thread id"),
    ...(typeof params.objective === "string" ? { objective: params.objective } : {}),
    ...(status === "active" || status === "paused" ? { status } : {}),
    ...(params.clear === true ? { clear: true } : {}),
  };
}

/** Stop every chat that belongs to the project before its worktrees disappear.
 *  dispose kills the ACP child and archives the row, so the session leaves the
 *  global list and does not stay `running` against a deleted directory. */
export async function disposeProjectSessions(
  sessions: SessionManager | undefined,
  projectId: string,
  workspaceIds: readonly string[] = [],
): Promise<string[]> {
  const owned = listSessionsForProjectRemoval(projectId, workspaceIds);
  if (owned.length === 0) return [];
  if (!sessions) {
    throw new ControlError(
      "error",
      `Cannot remove project ${projectId} while ${owned.length} session(s) are still attached. Stop them first.`,
    );
  }
  const disposed: string[] = [];
  for (const session of owned) {
    await sessions.dispose(session.id);
    disposed.push(session.id);
  }
  return disposed;
}

async function removeProject(
  workspaces: WorkspaceService,
  sessions: SessionManager | undefined,
  params: Record<string, unknown>,
  onProjectsChanged?: () => void,
) {
  const id = requiredString(params, "id", "Project id");
  if (!getProject(id)) throw new ControlError("not_found", `Project not found: ${id}`);
  const workspacesForProject = await workspaces.list(id);
  const disposedSessions = await disposeProjectSessions(
    sessions,
    id,
    workspacesForProject.map((workspace) => workspace.id),
  );
  for (const workspace of workspacesForProject) {
    if (workspace.kind !== "managed") continue;
    await workspaces.delete(workspace.id, { force: params.force === true });
  }
  deleteProject(id);
  onProjectsChanged?.();
  return { id, removed: true, disposed_sessions: disposedSessions };
}

function requireSessions(sessions: SessionManager | undefined): SessionManager {
  if (!sessions) throw new ControlError("error", "Session control is not available");
  return sessions;
}

function requireWork(work: ControlWorkApi | undefined): ControlWorkApi {
  if (!work) throw new ControlError("error", "Project work control is not available");
  return work;
}

function timeoutSeconds(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ControlError("invalid_args", "--timeout must be a positive number of seconds");
  }
  return parsed;
}

async function waitFor(promise: Promise<void>, timeoutSec: number | undefined): Promise<boolean> {
  if (timeoutSec === undefined) {
    await promise;
    return false;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutSec * 1000);
  });
  const timedOut = await Promise.race([
    promise.then(() => false),
    timeout,
  ]);
  if (timer) clearTimeout(timer);
  return timedOut;
}

export type ControlApi = ReturnType<typeof createControlApi>;
