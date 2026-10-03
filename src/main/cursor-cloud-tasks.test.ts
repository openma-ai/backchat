import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { OpenmaAccount } from "./openma-account.js";
import { OpenmaTasks } from "./openma-tasks.js";
import type { OpenmaExecutionTarget } from "../shared/openma.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "backchat-cursor-repo-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-b", "feature");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", "git@github.com:demo/app.git");
  await writeFile(join(root, "README.md"), "one\n");
  git("add", "README.md");
  git("commit", "-m", "initial");
  return root;
}

it("defaults a project thread to its git remote and queues a follow-up until the run ends", async () => {
  const directory = await mkdtemp(join(tmpdir(), "backchat-cursor-tasks-"));
  const sourcePath = await repository();
  const posts: Array<{ path: string; body: unknown }> = [];
  const streams: Array<{ enqueue: (text: string) => void }> = [];
  const remote: { agent: { id: string; status: string; latestRunId?: string; name?: string; createdAt?: string; updatedAt?: string; env?: unknown; repos?: unknown } | null } = { agent: null };
  const runs = new Map<string, { id: string; status: string; prompt: string }>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? "GET";
    if (method === "GET" && /^\/v1\/agents\/bc-[^/]+$/.test(path)) {
      return remote.agent && path === `/v1/agents/${remote.agent.id}` ? Response.json(remote.agent) : new Response("missing", { status: 404 });
    }
    if (path.endsWith("/conversation")) return new Response("missing", { status: 404 });
    if (path.endsWith("/runs") && method === "GET") return Response.json({ items: [...runs.values()] });
    if (path === "/v1/agents" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { agentId: string; prompt: { text: string }; repos?: unknown };
      posts.push({ path, body });
      const run = { id: "run-1", status: "RUNNING", prompt: body.prompt.text };
      runs.set(run.id, run);
      remote.agent = { id: body.agentId, name: "Read me", status: "ACTIVE", latestRunId: run.id, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", env: { type: "cloud" }, repos: body.repos };
      return Response.json({ agent: remote.agent, run: { id: run.id, status: "CREATING" } });
    }
    if (path.endsWith("/runs") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { prompt: { text: string } };
      posts.push({ path, body });
      if ([...runs.values()].some((run) => run.status === "CREATING" || run.status === "RUNNING")) {
        return Response.json({ error: { code: "agent_busy", message: "running" } }, { status: 409 });
      }
      const run = { id: `run-${runs.size + 1}`, status: "RUNNING", prompt: body.prompt.text };
      runs.set(run.id, run);
      remote.agent = { ...(remote.agent ?? { id: "", status: "ACTIVE" }), status: "ACTIVE", latestRunId: run.id };
      return Response.json({ run: { id: run.id, status: "CREATING" } });
    }
    if (path.includes("/runs/") && method === "GET" && !path.endsWith("/stream")) {
      const id = path.split("/").at(-1)!;
      return Response.json(runs.get(id) ?? { id, status: "RUNNING" });
    }
    if (path.endsWith("/stream")) {
      return new Response(new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          streams.push({ enqueue: (text) => controller.enqueue(encoder.encode(text)) });
          init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch { /* already closed */ } });
        },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const account = new OpenmaAccount({ directory });
  await account.connectDirect({ provider: "cursor-cloud", baseUrl: "https://api.cursor.com", apiKey: "cursor-key", name: "Cursor" });
  const connection = account.connection();
  const target: OpenmaExecutionTarget = {
    ...connection, kind: "cloud", agentId: "default", agentName: "Default", environmentId: "cloud", environmentName: "Cursor Cloud", runtimeId: null, runtimeName: "Cloud",
    cursor: { sourcePath },
  };
  const tasks = new OpenmaTasks({
    directory, account, fetchImpl, reconnectMs: 20,
    catalog: async () => ({ runners: [], cloudAgents: [{ id: "default", name: "Default" }], environments: [{ id: "cloud", name: "Cursor Cloud", type: "cloud", runtimeId: null }] }),
  });
  cleanups.push(async () => { tasks.close(); await rm(directory, { recursive: true, force: true }); await rm(sourcePath, { recursive: true, force: true }); });
  const created = await tasks.create(target, "Read me");
  expect(created.task.cursor).toMatchObject({ repoUrl: "https://github.com/demo/app", startingRef: "feature", pendingCreate: true });
  expect(created.task.sessionId).toMatch(/^bc-/);
  expect(posts).toEqual([]);
  tasks.open(created.task.id, "view");
  await tasks.send(created.task.id, "first", "Read the README");
  expect(posts).toHaveLength(1);
  expect(posts[0]!.body).toMatchObject({
    prompt: { text: "Read the README" },
    repos: [{ url: "https://github.com/demo/app", startingRef: "feature" }],
    name: "Read me",
  });
  expect(posts[0]!.body).not.toHaveProperty("model");
  await tasks.send(created.task.id, "second", "Also summarize it");
  expect(posts).toHaveLength(1);
  expect(tasks.snapshot(created.task.id).operations.map((operation) => operation.id)).toContain("second");
  await vi.waitFor(() => expect(streams.length).toBeGreaterThan(0));
  runs.get("run-1")!.status = "FINISHED";
  if (remote.agent) remote.agent.status = "IDLE";
  streams.at(-1)!.enqueue('event: result\ndata: {"runId":"run-1","status":"FINISHED","text":"Done","git":{"branches":[{"branch":"cursor/readme","prUrl":"https://github.com/demo/app/pull/9"}]}}\n\n');
  streams.at(-1)!.enqueue("event: done\ndata: {}\n\n");
  await vi.waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]!.body).toMatchObject({ prompt: { text: "Also summarize it" } });
  expect(tasks.snapshot(created.task.id).task.cursor).toMatchObject({ branch: "cursor/readme", prUrl: "https://github.com/demo/app/pull/9" });
  await tasks.update(created.task.id, { title: "Local title" });
  expect(tasks.snapshot(created.task.id).task.title).toBe("Local title");
  expect(posts).toHaveLength(2);
});

it("sends a queued follow-up after interrupt even if the terminal event arrives during cancel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "backchat-cursor-interrupt-"));
  const posts: string[] = [];
  const streams: Array<{ enqueue: (text: string) => void }> = [];
  let agent: { id: string; status: string; latestRunId?: string } | null = null;
  const runs = new Map<string, { id: string; status: string }>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? "GET";
    if (method === "GET" && /^\/v1\/agents\/bc-[^/]+$/.test(path)) {
      return agent && path.endsWith(`/${agent.id}`) ? Response.json(agent) : new Response("missing", { status: 404 });
    }
    if (path.endsWith("/conversation")) return new Response("missing", { status: 404 });
    if (path.endsWith("/runs") && method === "GET") return Response.json({ items: [...runs.values()] });
    if (path === "/v1/agents" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { agentId: string; prompt: { text: string } };
      posts.push(`create:${body.prompt.text}`);
      const run = { id: "run-1", status: "RUNNING" };
      runs.set(run.id, run);
      agent = { id: body.agentId, status: "ACTIVE", latestRunId: run.id };
      return Response.json({ agent, run: { id: run.id, status: "CREATING" } });
    }
    if (path.endsWith("/runs") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { prompt: { text: string } };
      if ([...runs.values()].some((run) => run.status === "RUNNING")) {
        return Response.json({ error: { code: "agent_busy", message: "running" } }, { status: 409 });
      }
      const run = { id: "run-2", status: "RUNNING" };
      runs.set(run.id, run);
      agent = { ...(agent ?? { id: "", status: "ACTIVE" }), status: "ACTIVE", latestRunId: run.id };
      posts.push(`follow:${body.prompt.text}`);
      return Response.json({ run: { id: run.id, status: "CREATING" } });
    }
    if (path.endsWith("/cancel") && method === "POST") {
      posts.push("cancel");
      const run = runs.get("run-1");
      if (run) run.status = "CANCELLED";
      if (agent) agent.status = "IDLE";
      streams.at(-1)?.enqueue('event: result\ndata: {"runId":"run-1","status":"CANCELLED","text":"Stopped."}\n\n');
      streams.at(-1)?.enqueue("event: done\ndata: {}\n\n");
      return Response.json({ id: "run-1" });
    }
    if (path.endsWith("/stream")) {
      return new Response(new ReadableStream({
        start(controller) {
          streams.push({ enqueue: (text) => controller.enqueue(new TextEncoder().encode(text)) });
          init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch { /* already closed */ } });
        },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    if (path.includes("/runs/")) return Response.json(runs.get(path.split("/").at(-1)!) ?? { id: "run-1", status: "RUNNING" });
    throw new Error(`unexpected ${method} ${path}`);
  };
  const account = new OpenmaAccount({ directory });
  await account.connectDirect({ provider: "cursor-cloud", baseUrl: "https://api.cursor.com", apiKey: "cursor-key", name: "Cursor" });
  const connection = account.connection();
  const tasks = new OpenmaTasks({
    directory, account, fetchImpl, reconnectMs: 20,
    catalog: async () => ({ runners: [], cloudAgents: [{ id: "default", name: "Default" }], environments: [{ id: "cloud", name: "Cursor Cloud", type: "cloud", runtimeId: null }] }),
  });
  cleanups.push(async () => { tasks.close(); await rm(directory, { recursive: true, force: true }); });
  const created = await tasks.create({
    ...connection, kind: "cloud", agentId: "default", agentName: "Default", environmentId: "cloud", environmentName: "Cursor Cloud", runtimeId: null, runtimeName: "Cloud",
  }, "Read me");
  tasks.open(created.task.id, "view");
  await tasks.send(created.task.id, "first", "Read the README");
  await tasks.send(created.task.id, "second", "Also summarize it");
  await vi.waitFor(() => expect(streams.length).toBeGreaterThan(0));
  await tasks.interrupt(created.task.id);
  await vi.waitFor(() => expect(posts).toContain("follow:Also summarize it"));
  expect(posts.filter((post) => post.startsWith("follow:"))).toEqual(["follow:Also summarize it"]);
  expect(posts).toContain("cancel");
});
