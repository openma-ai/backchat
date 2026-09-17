import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenmaTaskStore } from "./openma-task-store.js";
import type { OpenmaTask } from "../shared/openma.js";

let store: OpenmaTaskStore;
const roots: string[] = [];
afterEach(() => { store?.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const scope = { baseUrl: "https://app.openma.dev", userId: "user", workspaceId: "team" };
const task: OpenmaTask = { ...scope, id: "desktop-task", sessionId: "s", title: "Task", status: "running", createdAt: 1, updatedAt: 1, afterSeq: 0,
  target: { ...scope, kind: "cloud", agentId: "agent", agentName: "Agent", environmentId: "env", environmentName: "Env", runtimeId: null, runtimeName: "Cloud" } };
function setup() { const root = mkdtempSync(join(tmpdir(), "backchat-remote-tasks-")); roots.push(root); const path = join(root, "tasks.db"); store = new OpenmaTaskStore(path); return path; }

describe("durable OpenMA task cache", () => {
  it("searches titles and downloaded chat prose only within the selected workspace", () => {
    setup(); store.save(task);
    const other = { ...task, id: "other", workspaceId: "other", target: { ...task.target, workspaceId: "other" } };
    store.save(other);
    store.append(task.id, { id: "reply", seq: 2, type: "agent.message", content: [{ type: "text", text: "The review confirms the anonymous project." }] });
    store.append(other.id, { id: "private", seq: 3, type: "user.message", content: [{ type: "text", text: "private anonymous message" }] });
    store.append(task.id, { id: "tool", seq: 4, type: "agent.tool_use", input: { hidden: "tool-only-secret" } });
    store.setPreferences(task.id, { archived: true }, 10);
    expect(store.search(scope, "anonymous", 10)).toMatchObject([{ task: { id: task.id, archivedAt: 10 }, seq: 2, snippet: expect.stringContaining("\u2068anonymous\u2069") }]);
    expect(store.search(scope, "Task", 10)).toMatchObject([{ task: { id: task.id }, seq: 0 }]);
    expect(store.search(scope, "tool-only-secret", 10)).toEqual([]);
    expect(store.search({ ...scope, workspaceId: "missing" }, "anonymous", 10)).toEqual([]);
    expect(store.search(scope, "%", 10)).toEqual([]);
  });

  it("preserves desktop pin/archive preferences across remote refresh and restart", () => {
    const path = setup(); store.save(task);
    store.setPreferences(task.id, { pinned: true, archived: true }, 42);
    store.save({ ...task, title: "Renamed remotely", status: "idle", updatedAt: 5 });
    store.close(); store = new OpenmaTaskStore(path);
    expect(store.get(task.id)).toMatchObject({ title: "Renamed remotely", status: "idle", pinnedAt: 42, archivedAt: 42 });
    store.setPreferences(task.id, { archived: false }, 43);
    expect(store.get(task.id)).toMatchObject({ pinnedAt: 42, archivedAt: null });
    store.setPreferences(task.id, { pinned: false }, 44);
    expect(store.get(task.id)).toMatchObject({ pinnedAt: null, archivedAt: null });
    expect(store.list({ ...scope, workspaceId: "other" })).toEqual([]);
    expect(() => store.setPreferences("missing", { pinned: true }, 1)).toThrow(/task/i);
  });

  it("enriches an event with its durable sequence without skipping conflicting history", () => {
    setup(); store.save(task);
    const event = { id: "message", type: "agent.message", content: [] };
    store.append(task.id, event);
    expect(store.append(task.id, { ...event, seq: 4 })).toBe(true);
    expect(store.events(task.id)).toEqual([{ ...event, seq: 4 }]);
    expect(() => store.append(task.id, { ...event, seq: 9 })).toThrow(/sequence/i);
    expect(store.get(task.id)?.afterSeq).toBe(4);
  });
  it("pins a task's execution target and scopes remote IDs by account, workspace and server", () => {
    setup(); store.save(task);
    expect(store.list(scope)).toMatchObject([task]);
    expect(store.list({ ...scope, workspaceId: "elsewhere" })).toEqual([]);
    expect(store.list({ ...scope, userId: "other-user" })).toEqual([]);
    expect(store.list({ ...scope, baseUrl: "https://self-hosted.example" })).toEqual([]);
    expect(() => store.save({ ...task, target: { ...task.target, environmentId: "different" } })).toThrow(/target.*change/i);
    store.save({ ...task, id: "another", workspaceId: "elsewhere", target: { ...task.target, workspaceId: "elsewhere" } });
    expect(store.list({ ...scope, workspaceId: "elsewhere" })).toHaveLength(1);
  });

  it("commits events and the recovery cursor together and deduplicates history/reconnect overlap", () => {
    const path = setup(); store.save(task);
    const event = { id: "message", seq: 7, type: "agent.message", content: [{ type: "text", text: "hello" }] };
    expect(store.append(task.id, event)).toBe(true);
    expect(store.append(task.id, event)).toBe(false);
    store.close(); store = new OpenmaTaskStore(path);
    expect(store.get(task.id)?.afterSeq).toBe(7);
    expect(store.events(task.id)).toEqual([event]);
    expect(store.append(task.id, { id: "older", seq: 6, type: "user.message", content: [] })).toBe(true);
    expect(store.get(task.id)?.afterSeq).toBe(7);
    expect(store.events(task.id).map((e) => e.seq)).toEqual([6, 7]);
  });

  it("retains uncertain submissions across restart and reconciles them with server events", () => {
    const path = setup(); store.save(task);
    const event = { type: "user.message", content: [{ type: "text", text: "only once" }], metadata: { "backchat.operation_id": "op" } };
    expect(store.beginOperation(task.id, "op", event)).toBe(true);
    expect(store.beginOperation(task.id, "op", event)).toBe(false);
    store.close(); store = new OpenmaTaskStore(path);
    expect(store.operations(task.id)[0]?.state).toBe("uncertain");
    store.append(task.id, { ...event, id: "server-event", seq: 3 });
    expect(store.operations(task.id)).toEqual([]);
  });
});
