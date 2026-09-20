import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenmaRunnerOutbox } from "./openma-runner-outbox.js";
import {
  OmaBridgeClient,
  omaBridgeWebSocketUrl,
  type OmaBridgeSocket,
} from "./oma-bridge.js";

class FakeSocket implements OmaBridgeSocket {
  readyState = 0;
  sent: string[] = [];
  #handlers = new Map<string, Array<(...args: any[]) => void>>();

  on(event: string, handler: (...args: any[]) => void): this {
    this.#handlers.set(event, [...(this.#handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: any[]): void {
    for (const handler of this.#handlers.get(event) ?? []) handler(...args);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    for (const handler of this.#handlers.get("open") ?? []) handler();
  }

  receive(message: unknown): void {
    for (const handler of this.#handlers.get("message") ?? []) {
      handler(Buffer.from(JSON.stringify(message)));
    }
  }
}

describe("OmaBridgeClient", () => {
  it("reconnects immediately on wake without reviving a stopped runner", async () => {
    const sockets: FakeSocket[] = [];
    const client = new OmaBridgeClient({
      credentials: { serverUrl: "https://app.openma.ai", token: "secret", machineId: "machine" },
      host: { async start() { throw new Error("not used"); }, async prompt() {}, cancel() {}, async dispose() {}, announceAll() {} },
      detectAgents: async () => [],
      socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    });
    try {
      await client.connect(); sockets[0]!.open();
      client.resume();
      expect(sockets).toHaveLength(2);
      expect(sockets[0]!.readyState).toBe(3);
      // Late close on the old socket must not close the replacement.
      sockets[0]!.emit("close"); sockets[1]!.open();
      client.stop(); client.resume();
      expect(sockets).toHaveLength(2);
    } finally { client.stop(); }
  });

  it("reconnects a silent daemon link without declaring its running task complete", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const states: string[] = [];
    const client = new OmaBridgeClient({
      credentials: { serverUrl: "https://app.openma.ai", token: "secret", machineId: "machine" },
      host: { async start() { throw new Error("not used"); }, async prompt() {}, cancel() {}, async dispose() {}, announceAll() {} },
      detectAgents: async () => [],
      socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      onConnectionState: (state) => states.push(state),
    });
    try {
      await client.connect(); sockets[0]!.open();
      await vi.advanceTimersByTimeAsync(76_000);
      expect(sockets).toHaveLength(2);
      expect(sockets[0]!.readyState).toBe(3);
      expect(states).toContain("offline");
      expect(sockets[0]!.sent.map((frame) => JSON.parse(frame).type)).not.toContain("session.complete");
      client.stop();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(sockets).toHaveLength(2);
    } finally { client.stop(); vi.useRealTimers(); }
  });

  it("recovers offline output and a real completion after restart without replaying input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-recovery-"));
    const path = join(dir, "outbox.db");
    let outbox = new OpenmaRunnerOutbox(path, "server/user/runtime");
    let socket = new FakeSocket();
    const host = { start: vi.fn(async (p) => ({ status: "ready" as const, session_id: p.session_id, acp_session_id: "acp", agent_id: p.agent_id, cwd: p.cwd })), prompt: vi.fn(async () => {}), cancel: vi.fn(), dispose: vi.fn(async () => {}), announceAll: vi.fn() };
    const create = () => new OmaBridgeClient({
      credentials: { serverUrl: "https://app.openma.ai", token: "secret", machineId: "m", tenants: [{ id: "a", name: "a", agentApiKey: "key" }] },
      host, outbox, detectAgents: async () => [], socketFactory: () => socket,
      resolveWorkspace: async () => ({ localSessionId: "local", projectId: "p", cwd: "/work/p", additionalDirectories: [] }),
    });
    let client = create();
    try {
      await client.connect(); socket.open();
      socket.receive({ type: "welcome", capabilities: ["durable_session_events_v1"] });
      socket.receive({ type: "session.start", session_id: "remote", tenant_id: "a", agent_id: "codex-acp" });
      socket.receive({ type: "session.prompt", session_id: "remote", tenant_id: "a", turn_id: "turn", text: "go" });
      await vi.waitFor(() => expect(host.prompt).toHaveBeenCalledTimes(1));
      client.handleSessionEvent({ type: "session.ready", session_id: "local", acp_session_id: "acp", agent_id: "codex-acp", cwd: "/work/p" });
      const ready = JSON.parse(socket.sent.at(-1)!);
      socket.receive({ ...ready, type: "session.ack" });
      expect(outbox.pending()).toHaveLength(0);
      const decision = client.requestPermission("local", { options: [{ optionId: "allow" }] });
      const request = JSON.parse(socket.sent.at(-1)!);
      socket.receive({ type: "session.response", session_id: "remote", tenant_id: "a", turn_id: "turn", request_id: request.event.request_id, response: { outcome: { outcome: "selected", optionId: "allow" } } });
      await decision;
      expect(outbox.pending().map((frame) => (frame.event as { type: string }).type)).toEqual(["client.request", "client.response"]);
      socket.receive({ ...outbox.pending().at(-1), type: "session.ack" });
      client.handleSessionEvent({ type: "session.event", session_id: "local", turn_id: "turn", event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before " } } });
      const sentButUnconfirmed = JSON.parse(socket.sent.at(-1)!);
      socket.close(); socket.emit("close");
      client.handleSessionEvent({ type: "session.event", session_id: "local", turn_id: "turn", event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "offline" } } });
      client.handleSessionEvent({ type: "session.complete", session_id: "local", turn_id: "turn", stop_reason: "end_turn" });
      expect(outbox.pending().map((frame) => frame.type)).toEqual(["session.event", "session.event", "session.event", "session.complete"]);
      client.stop(); outbox.close();
      outbox = new OpenmaRunnerOutbox(path, "server/user/runtime");
      socket = new FakeSocket(); client = create();
      await client.connect(); socket.open();
      await vi.waitFor(() => expect(socket.sent.map((f) => JSON.parse(f).type)).toEqual(["hello"]));
      socket.receive({ type: "welcome", capabilities: ["durable_session_events_v1"] });
      const replayed = socket.sent.map((f) => JSON.parse(f)).filter((f) => f.delivery);
      expect(replayed).toEqual(outbox.pending());
      expect(replayed[0]).toEqual(sentButUnconfirmed);
      expect(replayed.at(-2).event).toEqual({ type: "promptComplete", response: { stopReason: "end_turn" } });
      expect(host.prompt).toHaveBeenCalledTimes(1);
      socket.receive({ ...replayed.at(-1), type: "session.ack", tenant_id: "wrong" });
      expect(outbox.pending()).toHaveLength(4);
      socket.receive({ ...replayed.at(-1), type: "session.ack" });
      expect(outbox.pending()).toEqual([]);
    } finally { client.stop(); outbox.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("relays original permission options and resolves only a matching workspace, turn and request", async () => {
    const socket = new FakeSocket();
    const host = { start: vi.fn(async (p) => ({ status: "ready" as const, session_id: p.session_id, acp_session_id: "acp", agent_id: p.agent_id, cwd: p.cwd })), prompt: vi.fn(async () => {}), cancel: vi.fn(), dispose: vi.fn(async () => {}), announceAll: vi.fn() };
    const client = new OmaBridgeClient({
      credentials: { serverUrl: "https://app.openma.ai", token: "secret", machineId: "m", tenants: ["a", "b"].map((id) => ({ id, name: id, agentApiKey: "key" })) },
      host, detectAgents: async () => [], socketFactory: () => socket,
      resolveWorkspace: async () => ({ localSessionId: "local", projectId: "p", cwd: "/work/p", additionalDirectories: [] }),
    });
    try {
      await client.connect(); socket.open();
      socket.receive({ type: "session.start", session_id: "remote", tenant_id: "a", agent_id: "codex-acp" });
      socket.receive({ type: "session.prompt", session_id: "remote", tenant_id: "a", turn_id: "turn", text: "go" });
      await vi.waitFor(() => expect(host.prompt).toHaveBeenCalledTimes(1));
      const params = { toolCall: { toolCallId: "tool", title: "Write file" }, options: [{ optionId: "yes-original", name: "Allow once", kind: "allow_once" }, { optionId: "no-original", name: "Reject", kind: "reject_once" }] };
      let settled = false;
      const pending = client.requestPermission("local", params).then((result) => { settled = true; return result; });
      const request = JSON.parse(socket.sent.at(-1)!);
      expect(request).toMatchObject({ type: "session.event", session_id: "remote", tenant_id: "a", turn_id: "turn", event: { type: "client.request", method: "session/request_permission", params } });
      const response = { type: "session.response", session_id: "remote", tenant_id: "a", turn_id: "turn", request_id: request.event.request_id, response: { outcome: { outcome: "selected", optionId: "yes-original" } } };
      socket.receive({ ...response, tenant_id: "b" });
      socket.receive({ ...response, turn_id: "other-turn" });
      socket.receive({ ...response, response: { outcome: { outcome: "selected", optionId: "invented" } } });
      await Promise.resolve(); expect(settled).toBe(false);
      socket.receive(response);
      expect(await pending).toEqual(response.response);
      socket.receive(response);
      expect(host.prompt).toHaveBeenCalledTimes(1);
      const cancelled = client.requestPermission("local", params);
      client.cancelPendingFor("local");
      expect(await cancelled).toEqual({ outcome: { outcome: "cancelled" } });
      const sentBeforeCancel = socket.sent.length;
      client.handleSessionEvent({ type: "session.cancelled", session_id: "local", turn_id: "turn" });
      expect(socket.sent).toHaveLength(sentBeforeCancel);
      client.handleSessionEvent({ type: "session.cancelled", session_id: "local", turn_id: "turn", stop_reason: "cancelled" });
      expect(socket.sent.map((frame) => JSON.parse(frame)).slice(-2)).toMatchObject([
        { type: "session.event", session_id: "remote", turn_id: "turn", event: { type: "promptComplete", response: { stopReason: "cancelled" } } },
        { type: "session.complete", session_id: "remote", turn_id: "turn" },
      ]);
    } finally { client.stop(); }
  });

  it("isolates equal remote IDs in different workspaces and restores wire IDs on every host response", async () => {
    const socket = new FakeSocket();
    const host = {
      start: vi.fn(async (p) => ({ status: "ready" as const, session_id: p.session_id, acp_session_id: "acp", agent_id: p.agent_id, cwd: p.cwd })),
      prompt: vi.fn(async () => {}), cancel: vi.fn(), dispose: vi.fn(async () => {}), announceAll: vi.fn(),
    };
    const client = new OmaBridgeClient({
      credentials: { serverUrl: "https://app.openma.ai", token: "secret", machineId: "m", tenants: ["a", "b"].map((id) => ({ id, name: id, agentApiKey: "key" })) },
      host, detectAgents: async () => [], socketFactory: () => socket,
      resolveWorkspace: async (_id, tenant) => ({ localSessionId: `runner-${tenant}`, projectId: tenant, cwd: `/work/${tenant}`, additionalDirectories: [] }),
    });
    try {
      await client.connect(); socket.open();
      for (const tenant of ["a", "b"]) {
        socket.receive({ type: "session.start", session_id: "same", tenant_id: tenant, agent_id: "codex-acp" });
        socket.receive({ type: "session.prompt", session_id: "same", tenant_id: tenant, turn_id: "turn", text: tenant });
      }
      await vi.waitFor(() => expect(host.prompt).toHaveBeenCalledTimes(2));
      for (const tenant of ["a", "b"]) {
        expect(host.start).toHaveBeenCalledWith(expect.objectContaining({ session_id: `runner-${tenant}`, cwd: `/work/${tenant}` }));
        expect(host.prompt).toHaveBeenCalledWith({ session_id: `runner-${tenant}`, turn_id: "turn", text: tenant });
        client.handleSessionEvent({ type: "session.event", session_id: `runner-${tenant}`, turn_id: "turn", event: { sessionUpdate: "agent_message_chunk" } });
        expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: "session.event", session_id: "same", tenant_id: tenant });
        socket.receive({ type: "session.cancel", session_id: "same", tenant_id: tenant, turn_id: "turn" });
        socket.receive({ type: "session.dispose", session_id: "same", tenant_id: tenant });
      }
      await vi.waitFor(() => expect(host.dispose).toHaveBeenCalledTimes(2));
      expect(host.cancel.mock.calls).toEqual([["runner-a", "turn"], ["runner-b", "turn"]]);
      expect(host.dispose.mock.calls).toEqual([["runner-a"], ["runner-b"]]);
      const count = socket.sent.length;
      client.handleSessionEvent({ type: "session.event", session_id: "same", turn_id: "turn", event: {} });
      expect(socket.sent).toHaveLength(count);
    } finally { client.stop(); }
  });

  it("resolves the task's linked project before starting and ignores caller-supplied paths", async () => {
    const socket = new FakeSocket();
    const started: unknown[] = [];
    const prompts: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const client = new OmaBridgeClient({
      credentials: { serverUrl: "https://app.openma.ai", token: "secret", machineId: "machine" },
      host: { start: async (p) => { started.push(p); return { status: "ready", session_id: p.session_id, acp_session_id: "acp", agent_id: p.agent_id, cwd: p.cwd! }; }, prompt: async (p) => { prompts.push(p.text); }, cancel: () => {}, dispose: async () => {}, announceAll: () => {} },
      resolveWorkspace: async () => { await gate; return { localSessionId: "local-s", projectId: "project", cwd: "/work/project", additionalDirectories: ["/work/library"] }; },
      detectAgents: async () => [], socketFactory: () => socket,
    });
    try {
      await client.connect(); socket.open();
      socket.receive({ type: "session.start", session_id: "s", tenant_id: "team", agent_id: "codex-acp", cwd: "/", additional_directories: ["/private"] });
      socket.receive({ type: "session.prompt", session_id: "s", tenant_id: "team", turn_id: "t", text: "go" });
      expect(started).toEqual([]);
      expect(prompts).toEqual([]);
      release();
      await vi.waitFor(() => expect(prompts).toEqual(["go"]));
      expect(started).toEqual([{ session_id: "local-s", agent_id: "codex-acp", project_id: "project", workspace_mode: "project", cwd: "/work/project", additional_directories: ["/work/library"] }]);
    } finally { release(); client.stop(); }
  });

  it("reports unlinked environments without starting any local agent", async () => {
    const socket = new FakeSocket();
    let starts = 0;
    const client = new OmaBridgeClient({
      credentials: { serverUrl: "https://app.openma.ai", token: "secret", machineId: "machine" },
      host: { start: async (p) => { starts++; return { status: "cancelled", session_id: p.session_id }; }, prompt: async () => {}, cancel: () => {}, dispose: async () => {}, announceAll: () => {} },
      resolveWorkspace: async () => { throw new Error("This environment has no linked project on this runner"); },
      detectAgents: async () => [], socketFactory: () => socket,
    });
    try {
      await client.connect(); socket.open();
      socket.receive({ type: "session.start", session_id: "s", tenant_id: "team", agent_id: "codex-acp" });
      await vi.waitFor(() => expect(socket.sent.map((s) => JSON.parse(s))).toContainEqual(expect.objectContaining({ type: "session.error", message: expect.stringMatching(/linked project/) })));
      expect(starts).toBe(0);
    } finally { client.stop(); }
  });

  it("reports an occupied runtime without reconnecting over the existing daemon", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    let connections = 0;
    const socket = new FakeSocket();
    const client = new OmaBridgeClient({
      credentials: { serverUrl: "https://app.openma.ai", token: "secret", machineId: "machine" },
      host: { start: async () => ({ status: "cancelled", session_id: "s" }), prompt: async () => {}, cancel: () => {}, dispose: async () => {}, announceAll: () => {} },
      detectAgents: async () => [],
      socketFactory: () => { connections++; return socket; },
      onConnectionState: (state: string) => states.push(state),
    });
    try {
      await client.connect();
      socket.emit("unexpected-response", {}, { statusCode: 409, resume: () => {} });
      socket.emit("close");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(states.at(-1)).toBe("occupied");
      expect(connections).toBe(1);
    } finally { client.stop(); vi.useRealTimers(); }
  });

  it("rejects commands outside the registered workspace and prompts without a start in that workspace", async () => {
    const socket = new FakeSocket();
    const started: string[] = [];
    const prompts: string[] = [];
    const client = new OmaBridgeClient({
      credentials: { serverUrl: "https://app.openma.ai", token: "secret", machineId: "machine", tenants: [{ id: "a", name: "A", agentApiKey: "a-key" }, { id: "b", name: "B", agentApiKey: "b-key" }] },
      host: {
        start: async (p) => { started.push(p.session_id); return { status: "ready", session_id: p.session_id, acp_session_id: "acp", agent_id: p.agent_id, cwd: p.cwd! }; },
        prompt: async (p) => { prompts.push(p.text); }, cancel: () => {}, dispose: async () => {}, announceAll: () => {},
      },
      resolveWorkspace: async (id) => ({ localSessionId: `local-${id}`, projectId: "p", cwd: "/work/p", additionalDirectories: [] }),
      detectAgents: async () => [], socketFactory: () => socket,
    });
    await client.connect(); socket.open();
    await new Promise((r) => setTimeout(r, 0));
    socket.receive({ type: "session.start", session_id: "bad", tenant_id: "unknown", agent_id: "codex-acp" });
    socket.receive({ type: "session.start", session_id: "s", tenant_id: "a", agent_id: "codex-acp" });
    socket.receive({ type: "session.prompt", session_id: "s", tenant_id: "b", turn_id: "t", text: "wrong" });
    socket.receive({ type: "session.prompt", session_id: "s", tenant_id: "a", turn_id: "t", text: "right" });
    await vi.waitFor(() => expect(prompts).toEqual(["right"]));
    expect(started).toEqual(["local-s"]);
    client.stop();
  });
  it("canonicalizes legacy production origins before WebSocket upgrade", () => {
    for (const origin of [
      "https://openma.dev",
      "https://app.openma.ai",
      "https://openma.ai",
      "https://app.openma.ai",
    ]) {
      expect(omaBridgeWebSocketUrl(origin)).toBe(
        "wss://app.openma.ai/agents/runtime/_attach",
      );
    }
    // Self-hosted and staging origins are left alone.
    expect(omaBridgeWebSocketUrl("https://app.staging.openma.dev")).toBe(
      "wss://app.staging.openma.dev/agents/runtime/_attach",
    );
  });

  it("shares one host session manager for cloud turns and forwards canonical bridge events", async () => {
    const socket = new FakeSocket();
    const host = {
      start: vi.fn(async () => ({ status: "ready" as const, session_id: "sid", acp_session_id: "acp", agent_id: "claude-acp", cwd: "/tmp" })),
      prompt: vi.fn(async () => undefined),
      cancel: vi.fn(),
      dispose: vi.fn(async () => undefined),
      announceAll: vi.fn(),
    };
    const client = new OmaBridgeClient({
      credentials: {
        serverUrl: "https://app.openma.ai",
        token: "sk_machine_test",
        machineId: "machine-test",
      },
      host,
      resolveWorkspace: async (id) => ({ localSessionId: `local-${id}`, projectId: "p", cwd: "/work/p", additionalDirectories: [] }),
      detectAgents: async () => [{ id: "claude-acp", binary: "claude-agent-acp" }],
      socketFactory: () => socket,
    });

    await client.connect();
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      type: "hello",
      machine_id: "machine-test",
      agents: [{ id: "claude-acp", binary: "claude-agent-acp" }],
    });

    socket.receive({
      type: "session.start",
      session_id: "sid",
      tenant_id: "tenant-1",
      agent_id: "claude-acp",
    });
    socket.receive({
      type: "session.prompt",
      session_id: "sid",
      tenant_id: "tenant-1",
      turn_id: "turn-1",
      text: "hello",
    });
    await vi.waitFor(() => expect(host.prompt).toHaveBeenCalledWith(expect.objectContaining({ session_id: "local-sid", turn_id: "turn-1", text: "hello" })));
    expect(host.start).toHaveBeenCalledWith(expect.objectContaining({ session_id: "local-sid", agent_id: "claude-acp" }));

    const ready = { type: "session.ready" as const, session_id: "local-sid", acp_session_id: "acp", agent_id: "claude-acp", cwd: "/work/p" };
    client.handleSessionEvent(ready);
    client.handleSessionEvent(ready);
    expect(socket.sent.map((s) => JSON.parse(s)).filter((event) => event.type === "session.ready")).toHaveLength(2);

    client.handleSessionEvent({
      type: "session.event",
      session_id: "local-sid",
      turn_id: "turn-1",
      event: { sessionUpdate: "agent_message_chunk" },
    });
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: "session.event",
      session_id: "sid",
      tenant_id: "tenant-1",
      turn_id: "turn-1",
      event: { sessionId: "acp", update: { sessionUpdate: "agent_message_chunk" } },
    });
    client.handleSessionEvent({ type: "session.complete", session_id: "local-sid", turn_id: "turn-1", stop_reason: "end_turn", usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 } });
    expect(socket.sent.map((frame) => JSON.parse(frame)).slice(-2)).toMatchObject([
      { type: "session.event", session_id: "sid", tenant_id: "tenant-1", turn_id: "turn-1", event: { type: "promptComplete", response: { stopReason: "end_turn", usage: { inputTokens: 12, outputTokens: 7 } } } },
      { type: "session.complete", session_id: "sid", tenant_id: "tenant-1", turn_id: "turn-1" },
    ]);
    client.stop();
  });
});
