import { afterEach, expect, it, vi } from "vitest";
import { SessionStore } from "./session-store";
import type { OpenmaTask } from "@shared/openma";

const scope = { baseUrl: "https://app.openma.ai", userId: "user", workspaceId: "team" };
const task: OpenmaTask = { ...scope, id: "openma-task", sessionId: "remote", title: "Original", status: "running", createdAt: 1, updatedAt: 2, afterSeq: 0,
  target: { ...scope, kind: "cloud", agentId: "agent", agentName: "Agent", environmentId: "env", environmentName: "Env", runtimeId: null, runtimeName: "Cloud" } };
afterEach(() => vi.unstubAllGlobals());

it("does not roll back newer task metadata when an earlier list result arrives late", () => {
  const store = new SessionStore();
  store.seedOpenmaTasks([{ ...task, revision: 2, title: "New title", pinnedAt: 9 }]);
  store.seedOpenmaTasks([{ ...task, revision: 1, title: "Old title", pinnedAt: null }]);
  expect(store.get(task.id)).toMatchObject({ label: "New title", pinnedAt: 9 });
});

it("refreshes remote row metadata without discarding its active history or approval", () => {
  const store = new SessionStore();
  store.applyOpenmaSnapshot({ task, connection: "online", operations: [], events: [
    { type: "user.message", id: "prompt", content: [{ type: "text", text: "Work" }] },
    { type: "agent.custom_tool_use", id: "ask", name: "Question", input: {} },
  ] });
  const before = store.get(task.id)!;
  store.seedOpenmaTasks([{ ...task, title: "Changed elsewhere", pinnedAt: 3, archivedAt: 4, updatedAt: 5 }]);
  expect(store.get(task.id)).toMatchObject({ label: "Changed elsewhere", pinnedAt: 3, archivedAt: 4,
    activeTurnId: before.activeTurnId, pendingAsks: before.pendingAsks, remoteConnection: "online",
  });
  expect(store.list()).toEqual([]);
  store.seedOpenmaTasks([{ ...task, archivedAt: null, pinnedAt: null }]);
  expect(store.list().map((row) => row.id)).toEqual([task.id]);
  expect(store.get(task.id)?.pinnedAt).toBeUndefined();
});

it("routes remote row actions to OpenMA and applies only successful, still-visible results", async () => {
  const store = new SessionStore(); store.seedOpenmaTasks([task]);
  const calls: unknown[][] = [];
  let remote = { ...task };
  vi.stubGlobal("window", { backchat: {
    openmaTaskUpdate: async (id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) => {
      calls.push([id, patch]);
      if (patch.title) remote = { ...remote, title: patch.title };
      if (patch.pinned !== undefined) remote = { ...remote, pinnedAt: patch.pinned ? 3 : null };
      if (patch.archived !== undefined) remote = { ...remote, archivedAt: patch.archived ? 4 : null };
      return remote;
    },
  } });
  await store.rename(task.id, "New name");
  await store.pin(task.id); await store.archive(task.id);
  expect(store.get(task.id)).toMatchObject({ label: "New name", pinnedAt: 3, archivedAt: 4 });
  await store.unarchive(task.id); await store.unpin(task.id);
  expect(store.get(task.id)).toMatchObject({ label: "New name", pinnedAt: undefined, archivedAt: undefined });
  expect(calls).toEqual([[task.id, { title: "New name" }], [task.id, { pinned: true }], [task.id, { archived: true }], [task.id, { archived: false }], [task.id, { pinned: false }]]);
  window.backchat.openmaTaskUpdate = async () => { throw new Error("Server unavailable"); };
  await expect(store.rename(task.id, "Failed")).rejects.toThrow("Server unavailable");
  expect(store.get(task.id)?.label).toBe("New name");
  let finish!: (task: OpenmaTask) => void;
  window.backchat.openmaTaskUpdate = () => new Promise((resolve) => { finish = resolve; });
  const rename = store.rename(task.id, "Stale");
  store.clearOpenmaTasks(); finish({ ...task, title: "Stale" }); await rename;
  expect(store.get(task.id)).toBeUndefined();
});

it("prunes only revoked tenant scopes and never converts a tenant draft into a local session", () => {
  const store = new SessionStore();
  const other = { ...scope, workspaceId: "other" };
  store.seedOpenmaTasks([task, { ...task, ...other, id: "other-task", target: { ...task.target, ...other } }]);
  const draft = store.newDraft(); store.setExecutionTarget(draft, task.target);
  store.retainOpenmaScopes([other]);
  expect(store.get(task.id)).toBeUndefined();
  expect(store.get("other-task")).toBeDefined();
  expect(store.get(draft)).toBeUndefined();
});
