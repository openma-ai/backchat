import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenmaAccount } from "./openma-account.js";
import { OpenmaTasks } from "./openma-tasks.js";
import type { OpenmaExecutionTarget, OpenmaTaskEvent, OpenmaTaskSnapshot } from "../shared/openma.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const target: OpenmaExecutionTarget = { baseUrl: "https://app.openma.dev", userId: "user", workspaceId: "team", kind: "cloud", agentId: "agent", agentName: "Helper", environmentId: "env", environmentName: "Cloud project", runtimeId: null, runtimeName: "Cloud" };

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "backchat-tasks-"));
  const state = { sends: 0, creates: 0, streams: 0, mutations: [] as string[], events: [] as OpenmaTaskEvent[], pushes: [] as OpenmaTaskSnapshot[], lostAck: false, title: "Task", failRename: false, listRequests: 0, listRemote: false, listGate: null as Promise<void> | null, controller: null as ReadableStreamDefaultController<Uint8Array> | null };
  const fetchImpl: typeof fetch = async (url, init) => {
    const request = new Request(url, init); const path = new URL(request.url).pathname;
    if (path === "/v1/oma/me") return Response.json({ user: { id: "user", email: "user@example.com", name: "User" }, tenant: { id: "team" }, tenants: [{ id: "team", name: "Team", role: "owner" }] });
    expect(request.headers.get("x-active-tenant")).toBe("team");
    if (request.method !== "GET") state.mutations.push(`${request.method} ${path}`);
    if (path === "/v1/sessions" && request.method === "POST") { state.creates++; return Response.json({ id: "remote", status: "idle", created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z" }); }
    if (path === "/v1/sessions") {
      const data = [{ id: state.listRemote ? "remote" : "existing", title: state.listRemote ? state.title : "Existing cloud task", agent: { id: "agent", name: "Original helper" }, environment_id: "env", status: "idle", created_at: "2026-09-13T00:00:00Z", metadata: {} }];
      state.listRequests++;
      await state.listGate;
      return Response.json({ data });
    }
    if (path === "/v1/sessions/remote") {
      if (request.method === "POST") {
        expect(await request.json()).toEqual({ title: "Renamed" });
        if (state.failRename) return new Response("unavailable", { status: 503 });
        state.title = "Renamed";
      }
      return Response.json({ id: "remote", status: state.events.some((e) => e.type === "session.status_running") ? "running" : "idle", title: state.title });
    }
    if (path === "/v1/sessions/remote/events" && request.method === "POST") {
      state.sends++; const body = await request.json() as { events: OpenmaTaskEvent[] };
      state.events.push({ ...body.events[0]!, id: `e${state.events.length + 1}`, seq: state.events.length + 1 });
      if (state.lostAck) throw new Error("socket closed after acceptance");
      return new Response(null, { status: 202 });
    }
    if (path === "/v1/sessions/remote/events/stream") {
      state.streams++;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        state.controller = controller;
        request.signal.addEventListener("abort", () => { try { controller.close(); } catch {} });
      } }), { headers: { "content-type": "text/event-stream" } });
    }
    if (path === "/v1/sessions/remote/events") return Response.json({ data: state.events, has_more: false });
    throw new Error(`unexpected request ${path}`);
  };
  const account = new OpenmaAccount({ directory, fetch: fetchImpl, authorize: async () => ({ user: "user", tokens: [{ tenant_id: "team", tenant_name: "Team", role: "owner", token: "key", key_id: "kid" }] }) });
  await account.login(target.baseUrl);
  const tasks = new OpenmaTasks({ directory, account, fetchImpl, reconnectMs: 10, onSnapshot: (snapshot) => state.pushes.push(snapshot), catalog: async () => ({ runners: [], cloudAgents: [{ id: "agent", name: "Helper" }], environments: [{ id: "env", name: "Cloud project", type: "cloud", runtimeId: null }] }) });
  cleanups.push(async () => { tasks.close(); await rm(directory, { recursive: true, force: true }); });
  return { tasks, state, account };
}

describe("OpenMA desktop task observer", () => {
  it("preserves a successful rename when a refresh started before it returns stale metadata", async () => {
    const { tasks, state } = await setup();
    const { task } = await tasks.create(target, "Task");
    state.listRemote = true;
    let release!: () => void;
    state.listGate = new Promise<void>((resolve) => { release = resolve; });
    const refresh = tasks.refresh();
    try {
      await vi.waitFor(() => expect(state.listRequests).toBe(1));
      await tasks.update(task.id, { title: "Renamed" });
      release();
      expect((await refresh)[0]?.title).toBe("Renamed");
    } finally { release(); await refresh; }
  });

  it("routes title updates through the SDK and keeps pin/archive reversible without stopping work", async () => {
    const { tasks, state, account } = await setup();
    const { task } = await tasks.create(target, "Task");
    tasks.open(task.id);
    await vi.waitFor(() => expect(state.streams).toBe(1));
    state.events.push({ id: "running", seq: 1, type: "session.status_running" });
    expect(await tasks.update(task.id, { title: " Renamed " })).toMatchObject({ title: "Renamed" });
    expect(await tasks.update(task.id, { pinned: true, archived: true })).toMatchObject({ pinnedAt: expect.any(Number), archivedAt: expect.any(Number) });
    expect(tasks.snapshot(task.id).connection).toBe("online");
    expect(tasks.snapshot(task.id).task.status).toBe("running");
    expect(await tasks.update(task.id, { archived: false })).toMatchObject({ archivedAt: null, pinnedAt: expect.any(Number) });
    expect(await tasks.update(task.id, { pinned: false })).toMatchObject({ pinnedAt: null });
    expect(state.mutations).toEqual(["POST /v1/sessions", "POST /v1/sessions/remote"]);
    await account.logout();
    await expect(tasks.update(task.id, { title: "Renamed" })).rejects.toThrow(/signed|login/i);
    expect(state.mutations).toHaveLength(2);
  });

  it("does not pretend a failed remote rename succeeded or retry the mutation", async () => {
    const { tasks, state } = await setup();
    const { task } = await tasks.create(target, "Task");
    state.failRename = true;
    await expect(tasks.update(task.id, { title: "Renamed" })).rejects.toThrow();
    expect(tasks.list()[0]?.title).toBe("Task");
    expect(state.mutations).toEqual(["POST /v1/sessions", "POST /v1/sessions/remote"]);
  });

  it("keeps a shared subscription alive until every window or mounted view detaches", async () => {
    const { tasks, state } = await setup();
    const snapshot = await tasks.create(target, "Task");
    tasks.open(snapshot.task.id, "window-a:first");
    tasks.open(snapshot.task.id, "window-b:first");
    await vi.waitFor(() => expect(state.streams).toBe(1));
    tasks.open(snapshot.task.id, "window-a:remount");
    tasks.detach(snapshot.task.id, "window-a:first");
    expect(tasks.snapshot(snapshot.task.id).connection).toBe("online");
    tasks.releaseOwner("window-b:first");
    expect(tasks.snapshot(snapshot.task.id).connection).toBe("online");
    const event = { type: "agent.message", id: "still-observed", seq: 1, content: [] };
    state.controller!.enqueue(new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
    await vi.waitFor(() => expect(tasks.snapshot(snapshot.task.id).events.some((e) => e.id === event.id)).toBe(true));
    expect(state.streams).toBe(1);
    tasks.detach(snapshot.task.id, "window-a:first"); // Stale cleanup is harmless.
    expect(tasks.snapshot(snapshot.task.id).connection).toBe("online");
    tasks.releaseOwner("window-a:remount");
    expect(tasks.snapshot(snapshot.task.id).connection).toBe("offline");
    expect(state.mutations).toEqual(["POST /v1/sessions"]);
  });

  it("never checkpoints a transient pending-input promotion as durable history", async () => {
    const { tasks, state } = await setup();
    const snapshot = await tasks.create(target, "Task");
    tasks.open(snapshot.task.id);
    await vi.waitFor(() => expect(state.streams).toBe(1));
    const transient = { type: "system.user_message_promoted", event_id: "user", seq: 12 };
    state.controller!.enqueue(new TextEncoder().encode(`event: ${transient.type}\ndata: ${JSON.stringify(transient)}\n\n`));
    const marker = { type: "agent.message", id: "marker", seq: 1, content: [] };
    state.controller!.enqueue(new TextEncoder().encode(`event: ${marker.type}\ndata: ${JSON.stringify(marker)}\n\n`));
    await vi.waitFor(() => expect(tasks.snapshot(snapshot.task.id).events.some((event) => event.id === "marker")).toBe(true));
    expect(tasks.snapshot(snapshot.task.id).task.afterSeq).toBe(1);
    expect(tasks.snapshot(snapshot.task.id).events.some((e) => e.type === transient.type)).toBe(false);
  });
  it("discovers existing workspace tasks without registering a runner or sending input", async () => {
    const { tasks, state } = await setup();
    expect(await tasks.refresh()).toMatchObject([{ sessionId: "existing", title: "Existing cloud task", target: { agentName: "Original helper", environmentId: "env" } }]);
    expect(state.mutations).toEqual([]);
    expect(tasks.list()).toHaveLength(1);
  });
  it("creates cloud tasks without a local runner and never submits input while opening or reconnecting", async () => {
    const { tasks, state } = await setup();
    const snapshot = await tasks.create(target, "Task");
    tasks.open(snapshot.task.id);
    await vi.waitFor(() => expect(state.streams).toBe(1));
    expect(state.creates).toBe(1); expect(state.sends).toBe(0);
    await tasks.send(snapshot.task.id, "operation", "hello");
    expect(state.sends).toBe(1);
    state.events.push({ id: "running", seq: 2, type: "session.status_running" });
    state.controller!.close();
    await vi.waitFor(() => expect(state.streams).toBe(2));
    expect(state.sends).toBe(1);
    expect(tasks.snapshot(snapshot.task.id).events.filter((e) => e.type === "user.message")).toHaveLength(1);
    expect(tasks.snapshot(snapshot.task.id).task.status).toBe("running");
    tasks.detach(snapshot.task.id);
    expect(state.mutations).toEqual(["POST /v1/sessions", "POST /v1/sessions/remote/events"]);
  });

  it("reconciles an ambiguous send from history without repeating it, and logout only stops observation", async () => {
    const { tasks, state, account } = await setup();
    const snapshot = await tasks.create(target, "Task");
    tasks.open(snapshot.task.id);
    await vi.waitFor(() => expect(state.streams).toBe(1));
    state.lostAck = true;
    await expect(tasks.send(snapshot.task.id, "same-operation", "once")).rejects.toThrow(/connection/i);
    expect(tasks.snapshot(snapshot.task.id).operations[0]?.state).toBe("uncertain");
    state.controller!.close();
    await vi.waitFor(() => expect(state.streams).toBe(2));
    await tasks.send(snapshot.task.id, "same-operation", "once");
    expect(state.sends).toBe(1);
    expect(tasks.snapshot(snapshot.task.id).operations).toEqual([]);
    await account.logout();
    expect(() => tasks.snapshot(snapshot.task.id)).toThrow(/login|signed/i);
    expect(state.mutations).toEqual(["POST /v1/sessions", "POST /v1/sessions/remote/events"]);
  });
});

it("routes simultaneous tenants by task ownership without changing the selected workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "backchat-tenants-"));
  const calls: string[] = [];
  const streams = new Set<string>();
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    const tenant = request.headers.get("x-api-key")!.replace("key-", "");
    const path = new URL(request.url).pathname;
    if (path === "/v1/oma/me") return Response.json({ user: { id: "user", email: "u@example.com" }, tenant: { id: tenant }, tenants: ["a", "b"].map((id) => ({ id, name: id, role: "owner" })) });
    expect(request.headers.get("x-active-tenant")).toBe(tenant);
    calls.push(`${tenant}:${request.method}:${path}`);
    if (path.endsWith("/events/stream")) return new Response(new ReadableStream({ start(controller) {
      streams.add(tenant);
      request.signal.addEventListener("abort", () => { streams.delete(tenant); controller.close(); });
    } }), { headers: { "content-type": "text/event-stream" } });
    if (path.endsWith("/events")) return request.method === "GET" ? Response.json({ data: [], has_more: false }) : new Response(null, { status: 202 });
    await gate;
    const session = { id: "same-id", title: tenant, status: "idle", agent: { id: "agent", name: "Helper" }, environment_id: "env" };
    return Response.json(request.method === "GET" && path === "/v1/sessions" ? { data: [session] } : session);
  };
  const account = new OpenmaAccount({ directory, fetch: fetchImpl, authorize: async () => ({ user: "user", tokens: ["a", "b"].map((id) => ({ tenant_id: id, tenant_name: id, role: "owner", token: `key-${id}`, key_id: id })) }) });
  await account.login(target.baseUrl);
  const tasks = new OpenmaTasks({ directory, account, fetchImpl, catalog: async () => ({ runners: [], cloudAgents: [{ id: "agent", name: "Helper" }], environments: [{ id: "env", name: "Cloud", type: "cloud", runtimeId: null }] }) });
  cleanups.push(async () => { tasks.close(); await rm(directory, { recursive: true, force: true }); });
  const a = { ...target, workspaceId: "a" }; const b = { ...target, workspaceId: "b" };
  // Multiple authorized tenants need no global selection to be usable.
  const first = await tasks.create(a, "A");
  const second = await tasks.create(b, "B");
  expect(first.task.id).not.toBe(second.task.id);
  expect(tasks.list()).toHaveLength(2);
  tasks.open(second.task.id);
  await vi.waitFor(() => expect(streams.has("b")).toBe(true));
  await account.selectWorkspace("a");
  expect(tasks.snapshot(second.task.id).connection).toBe("online");
  expect(streams.has("b")).toBe(true);
  await tasks.send(second.task.id, "b-message", "Hello B");
  expect(calls.at(-1)).toBe("b:POST:/v1/sessions/same-id/events");
  expect(account.state().activeWorkspaceId).toBe("a");
  expect(tasks.search("B").some((row) => row.task.id === second.task.id)).toBe(true);
  await expect(tasks.create({ ...b, userId: "someone-else" }, "Forbidden")).rejects.toThrow();
  account.invalidate(account.connection(a));
  expect(tasks.snapshot(second.task.id).connection).toBe("online");
  await tasks.send(second.task.id, "still-b", "Still B");
  await expect(tasks.send(first.task.id, "expired-a", "No")).rejects.toThrow();
  gate = new Promise<void>((resolve) => { release = resolve; });
  const creating = tasks.create(b, "Late");
  const rejected = expect(creating).rejects.toThrow(/login|changed/i);
  await vi.waitFor(() => expect(calls.at(-1)).toBe("b:POST:/v1/sessions"));
  await account.logout(); release!(); await rejected;
  expect(streams.size).toBe(0);
});
