import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenmaRunner } from "./openma-runner.js";
import type { OpenmaConnection } from "./openma-account.js";
import type { OmaBridgeClient } from "./oma-bridge.js";

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const connection: OpenmaConnection = { baseUrl: "https://app.openma.dev", workspaceId: "a", userId: "user", apiKey: "user-key" };
const host = { start: async () => ({ status: "cancelled" as const, session_id: "s" }), prompt: async () => {}, cancel: () => {}, dispose: async () => {}, announceAll: () => {} };

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "backchat-runner-")); roots.push(directory);
  return { directory, bridgeDirectory: directory, connection: () => connection, host, detectAgents: async () => [] };
}

describe("desktop runner opt-in", () => {
  it("uses an existing execution host through OpenMA and only disconnects its own client on disable", async () => {
    const options = await setup();
    const server = createServer();
    const sockets = new WebSocketServer({ server });
    let attachments = 0;
    sockets.on("connection", (socket) => { attachments++; socket.send(JSON.stringify({ type: "welcome" })); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const external = new WebSocket(baseUrl.replace("http:", "ws:") + "/agents/runtime/_attach");
    await once(external, "open");
    const scopedConnection = { ...connection, baseUrl };
    const credentials = { v: 2, serverUrl: baseUrl, machineId: "machine", runtimeId: "runtime", token: "machine-key", tenants: [{ id: "a", name: "A", agentApiKey: "tenant-key" }] };
    await writeFile(join(options.bridgeDirectory, "credentials.json"), JSON.stringify(credentials));
    const runner = new OpenmaRunner({ ...options, connection: () => scopedConnection,
      inspectDaemon: async () => ({ pid: 123, running: true }),
      fetchImpl: async (url, init) => {
        const request = new Request(url, init);
        if (new URL(request.url).pathname === "/v1/oma/runtimes") return Response.json({ runtimes: [{ id: "runtime" }] });
        if (new URL(request.url).pathname === "/agents/runtime/me") return Response.json({ runtime: { id: "runtime", machine_id: "machine", status: "online", last_heartbeat: Math.floor(Date.now() / 1000), version: "0.6.0" }, tenants: [{ id: "a" }] });
        throw new Error("unexpected request");
      },
    });
    try {
      await expect(runner.enable()).resolves.toBeUndefined();
      expect(runner.state()).toMatchObject({ enabled: true, hosting: "external", status: "online", runtimeId: "runtime" });
      expect(attachments).toBe(1);
      await runner.disable();
      expect(runner.state()).toMatchObject({ enabled: false, hosting: null, status: "disabled" });
      expect(external.readyState).toBe(WebSocket.OPEN);
      expect(JSON.parse(await readFile(join(options.bridgeDirectory, "credentials.json"), "utf8"))).toEqual(credentials);
    } finally {
      runner.stop(); external.terminate();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps external ownership across an outage and discards a late status response after logout", async () => {
    vi.useFakeTimers();
    const options = await setup();
    await writeFile(join(options.bridgeDirectory, "credentials.json"), JSON.stringify({ v: 2, serverUrl: connection.baseUrl, machineId: "machine", runtimeId: "runtime", token: "machine-key", tenants: [{ id: "a", name: "A", agentApiKey: "tenant-key" }] }));
    let status = "online";
    let defer: ((response: Response) => void) | undefined;
    let delay = false;
    const me = () => Response.json({ runtime: { id: "runtime", machine_id: "machine", status, last_heartbeat: Math.floor(Date.now() / 1000) }, tenants: [{ id: "a" }] });
    const runner = new OpenmaRunner({ ...options,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/v1/oma/runtimes")) return Response.json({ runtimes: [{ id: "runtime" }] });
        if (delay) return new Promise<Response>((resolve) => { defer = resolve; });
        return me();
      },
      createBridge: () => { throw new Error("an observer must not become an execution host"); },
    });
    try {
      await expect(runner.enable()).resolves.toBeUndefined();
      status = "offline";
      await vi.advanceTimersByTimeAsync(10_000);
      expect(runner.state()).toMatchObject({ enabled: true, hosting: "external", status: "offline" });
      delay = true;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(defer).toBeTypeOf("function");
      runner.stop(); status = "online"; defer!(me());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runner.state()).toMatchObject({ enabled: false, hosting: null, status: "disabled" });
    } finally { runner.stop(); }
  });

  it("does not reuse a runtime when the machine token resolves to another identity", async () => {
    const options = await setup();
    await writeFile(join(options.bridgeDirectory, "credentials.json"), JSON.stringify({ v: 2, serverUrl: connection.baseUrl, machineId: "machine", runtimeId: "runtime", token: "wrong-token", tenants: [{ id: "a", name: "A", agentApiKey: "tenant-key" }] }));
    const runner = new OpenmaRunner({ ...options,
      createBridge: () => ({ connect: async () => {}, stop: () => {}, handleSessionEvent: () => {} }),
      fetchImpl: async (url) => String(url).endsWith("/v1/oma/runtimes")
        ? Response.json({ runtimes: [{ id: "runtime" }] })
        : Response.json({ runtime: { id: "other", machine_id: "other-machine", status: "online", last_heartbeat: Math.floor(Date.now() / 1000) }, tenants: [{ id: "a" }] }),
    });
    try {
      await expect(runner.enable()).rejects.toThrow(/identity|machine/i);
      expect(runner.state().enabled).toBe(false);
    } finally { runner.stop(); }
  });

  it("resolves the environment from the authorized remote session with that workspace's key", async () => {
    const options = await setup();
    await writeFile(join(options.bridgeDirectory, "credentials.json"), JSON.stringify({ v: 2, serverUrl: connection.baseUrl, machineId: "machine", runtimeId: "runtime", token: "machine-key", tenants: [{ id: "a", name: "A", agentApiKey: "a-key" }, { id: "b", name: "B", agentApiKey: "b-key" }] }));
    let resolver: ConstructorParameters<typeof OmaBridgeClient>[0]["resolveWorkspace"];
    const scopes: unknown[] = [];
    const runner = new OpenmaRunner({ ...options,
      fetchImpl: async (url, init) => {
        const request = new Request(url, init);
        const path = new URL(request.url).pathname;
        if (path === "/v1/oma/runtimes") return Response.json({ runtimes: [{ id: "runtime" }] });
        if (path === "/agents/runtime/me") return Response.json({ runtime: { id: "runtime", machine_id: "machine", status: "offline", last_heartbeat: null }, tenants: [{ id: "a" }, { id: "b" }] });
        if (path === "/v1/sessions/s") {
          expect(request.headers.get("x-api-key")).toBe("b-key");
          expect(request.headers.get("x-active-tenant")).toBe("b");
          return Response.json({ id: "s", environment_id: "project-env" });
        }
        throw new Error(`unexpected path ${path}`);
      },
      resolveProject: (scope, runtimeId, environmentId) => { scopes.push({ scope, runtimeId, environmentId }); return { localSessionId: "runner-s", projectId: "p", cwd: "/work/p", additionalDirectories: [] }; },
      createBridge: (deps) => { resolver = deps.resolveWorkspace; return { connect: async () => {}, stop: () => {}, handleSessionEvent: () => {} }; },
    });
    try {
      await runner.enable();
      expect(resolver).toBeTypeOf("function");
      expect(await resolver!("s", "b", "codex-acp")).toEqual({ localSessionId: "runner-s", projectId: "p", cwd: "/work/p", additionalDirectories: [] });
      expect(scopes).toEqual([{ scope: { baseUrl: connection.baseUrl, userId: "user", workspaceId: "b" }, runtimeId: "runtime", environmentId: "project-env" }]);
      await expect(resolver!("s", "unknown", "codex-acp")).rejects.toThrow(/workspace/i);
    } finally { runner.stop(); }
  });

  it("does not register or attach just because the user is signed in", async () => {
    let requests = 0;
    const runner = new OpenmaRunner({ ...await setup(), fetchImpl: async () => { requests++; throw new Error("unexpected network"); } });
    await runner.restore();
    expect(runner.state().enabled).toBe(false);
    expect(runner.state().status).toBe("disabled");
    expect(requests).toBe(0);
  });

  it("registers with the separate exchange flow and saves the shared v2 runner identity", async () => {
    const options = await setup();
    const requests: Request[] = [];
    const runner = new OpenmaRunner({ ...options,
      authorize: async () => ({ code: "code", state: "nonce" }),
      fetchImpl: async (url, init) => {
        const request = new Request(url, init); requests.push(request);
        if (new URL(request.url).pathname === "/agents/runtime/exchange") {
          return Response.json({ runtime_id: "runtime", token: "machine-key", tenants: [{ id: "a", name: "A", agent_api_key: "tenant-key" }] });
        }
        if (new URL(request.url).pathname === "/v1/oma/me") return Response.json({ user: { id: "user" }, tenant: { id: "a" } });
        throw new Error("unexpected request");
      },
      createBridge: (deps) => ({ connect: async () => deps.onConnectionState?.("online"), stop: () => {}, handleSessionEvent: () => {} }),
    });
    await runner.restore(); await runner.enable();
    expect(runner.state()).toMatchObject({ enabled: true, status: "online", runtimeId: "runtime" });
    expect(JSON.stringify(runner.state())).not.toContain("key");
    expect(await requests[0]!.json()).toMatchObject({ code: "code", state: "nonce", multi_tenant: true });
    const saved = JSON.parse(await readFile(join(options.bridgeDirectory, "credentials.json"), "utf8"));
    expect(saved).toMatchObject({ v: 2, runtimeId: "runtime", tenants: [{ id: "a", name: "A", agentApiKey: "tenant-key" }] });
    expect(saved.machineId).toBe((await readFile(join(options.bridgeDirectory, "machine-id"), "utf8")).trim());
    await runner.disable();
    expect(runner.state()).toMatchObject({ enabled: false, status: "disabled" });
    expect(JSON.parse(await readFile(join(options.bridgeDirectory, "credentials.json"), "utf8")).token).toBe("machine-key");
  });

  it("leaves an unverifiable CLI process alone and records no desktop ownership", async () => {
    const options = await setup();
    const runner = new OpenmaRunner({ ...options,
      inspectDaemon: async () => ({ pid: 123, running: true }),
      fetchImpl: async () => { throw new Error("must not contact the occupied runner"); },
    });
    await runner.restore();
    await expect(runner.enable()).rejects.toThrow(/verified|profile/i);
    expect(runner.state()).toMatchObject({ enabled: false, status: "occupied" });
  });

  it("does not mistake a stale online database row for a running external host", async () => {
    const options = await setup();
    await writeFile(join(options.bridgeDirectory, "credentials.json"), JSON.stringify({ v: 2, serverUrl: connection.baseUrl, machineId: "machine", runtimeId: "runtime", token: "machine-key", tenants: [{ id: "a", name: "A", agentApiKey: "tenant-key" }] }));
    const runner = new OpenmaRunner({ ...options,
      fetchImpl: async (url) => String(url).endsWith("/v1/oma/runtimes")
        ? Response.json({ runtimes: [{ id: "runtime" }] })
        : Response.json({ runtime: { id: "runtime", machine_id: "machine", status: "online", last_heartbeat: Math.floor(Date.now() / 1000) - 300 }, tenants: [{ id: "a" }] }),
      createBridge: (deps) => ({ connect: async () => deps.onConnectionState?.("online"), stop: () => {}, handleSessionEvent: () => {} }),
    });
    try {
      await runner.enable();
      expect(runner.state()).toMatchObject({ enabled: true, hosting: "backchat", status: "online" });
    } finally { runner.stop(); }
  });

  it("releases only its observation when workspace authorization is revoked", async () => {
    vi.useFakeTimers();
    const options = await setup();
    await writeFile(join(options.bridgeDirectory, "credentials.json"), JSON.stringify({ v: 2, serverUrl: connection.baseUrl, machineId: "machine", runtimeId: "runtime", token: "machine-key", tenants: [{ id: "a", name: "A", agentApiKey: "tenant-key" }] }));
    let revoked = false;
    const runner = new OpenmaRunner({ ...options,
      fetchImpl: async (url) => String(url).endsWith("/v1/oma/runtimes")
        ? Response.json({ runtimes: [{ id: "runtime" }] })
        : Response.json({ runtime: { id: "runtime", machine_id: "machine", status: "online", last_heartbeat: Math.floor(Date.now() / 1000) }, tenants: revoked ? [] : [{ id: "a" }] }),
    });
    try {
      await runner.enable(); revoked = true;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(runner.state()).toMatchObject({ enabled: false, hosting: null, status: "expired" });
    } finally { runner.stop(); }
  });

  it("observes the winning host if another daemon connects between discovery and attachment", async () => {
    const options = await setup();
    await writeFile(join(options.bridgeDirectory, "credentials.json"), JSON.stringify({ v: 2, serverUrl: connection.baseUrl, machineId: "machine", runtimeId: "runtime", token: "machine-key", tenants: [{ id: "a", name: "A", agentApiKey: "tenant-key" }] }));
    const runner = new OpenmaRunner({ ...options,
      fetchImpl: async (url) => String(url).endsWith("/v1/oma/runtimes")
        ? Response.json({ runtimes: [{ id: "runtime" }] })
        : Response.json({ runtime: { id: "runtime", machine_id: "machine", status: "offline", last_heartbeat: null }, tenants: [{ id: "a" }] }),
      createBridge: (deps) => ({ connect: async () => deps.onConnectionState?.("occupied"), stop: () => {}, handleSessionEvent: () => {} }),
    });
    try {
      await runner.enable();
      expect(runner.state()).toMatchObject({ enabled: true, hosting: "external" });
      expect(runner.state().status).not.toBe("occupied");
    } finally { runner.stop(); }
  });
});
