import { describe, expect, it, vi } from "vitest";
import type { AcpSession, SessionOptions } from "@open-managed-agents-desktop/acp";
import { SessionManager } from "./session-manager";
import { appendEvent, appendEventsTx } from "./sql-store.js";

const mocks = vi.hoisted(() => ({
  runtimeStart: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    once(event: string, cb: (code?: number) => void) {
      if (event === "exit") queueMicrotask(() => cb(0));
      return this;
    },
  })),
}));

vi.mock("@open-managed-agents-desktop/acp", () => ({
  AcpRuntimeImpl: vi.fn().mockImplementation(function AcpRuntimeImpl() {
    return {
      start: mocks.runtimeStart,
    };
  }),
}));

vi.mock("@open-managed-agents-desktop/acp/node-spawner", () => ({
  NodeSpawner: vi.fn(),
}));

vi.mock("@open-managed-agents-desktop/acp/registry", () => ({
  resolveKnownAgent: vi.fn(() => ({
    id: "codex-acp",
    label: "Codex",
    spec: { command: "node", args: [] },
  })),
}));

vi.mock("@open-managed-agents-desktop/acp/binary-update", () => ({
  ensureLatestAcpBinary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./sql-store.js", () => ({
  appendEvent: vi.fn(),
  appendEventsTx: vi.fn(),
  archiveSession: vi.fn(),
  setSessionTitleIfEmpty: vi.fn(),
  touchSession: vi.fn(),
  upsertSession: vi.fn(),
}));

vi.mock("./session-cwd.js", () => ({
  ensureSessionCwd: vi.fn().mockResolvedValue("/tmp/backchat-test"),
  removeSessionCwd: vi.fn(),
}));

describe("SessionManager prompt queue", () => {
  it("serializes prompts for one ACP session", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-queue",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const first = manager.prompt({
      session_id: "sess-queue",
      turn_id: "turn-1",
      text: "one",
    });
    const second = manager.prompt({
      session_id: "sess-queue",
      turn_id: "turn-2",
      text: "two",
    });

    expect(fake.prompts).toEqual([[{ type: "text", text: "one" }]]);

    fake.releaseNext();
    await first;
    await vi.waitUntil(() => fake.prompts.length === 2);

    expect(fake.prompts).toEqual([
      [{ type: "text", text: "one" }],
      [{ type: "text", text: "two" }],
    ]);

    fake.releaseNext();
    await second;

    expect(
      events
        .filter((event): event is { type: string; turn_id: string } =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: string }).type === "session.complete",
        )
        .map((event) => event.turn_id),
    ).toEqual(["turn-1", "turn-2"]);
  });

  it("converts prompt attachments into ACP content blocks", async () => {
    const fake = createControllableAcpSession({
      promptCapabilities: { image: true },
    });
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: () => undefined,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-attachments",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const prompt = manager.prompt({
      session_id: "sess-attachments",
      turn_id: "turn-attachments",
      text: "review this",
      attachments: [
        {
          id: "att-image",
          name: "screen.png",
          path: "/tmp/screen.png",
          uri: "file:///tmp/screen.png",
          kind: "image",
          mimeType: "image/png",
          size: 68,
          data: "iVBORw0KGgo=",
        },
        {
          id: "att-file",
          name: "notes.md",
          path: "/tmp/notes.md",
          uri: "file:///tmp/notes.md",
          kind: "file",
          mimeType: "text/markdown",
          size: 42,
        },
      ],
    });

    expect(fake.prompts).toEqual([
      [
        { type: "text", text: "review this" },
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
          uri: "file:///tmp/screen.png",
        },
        {
          type: "resource_link",
          uri: "file:///tmp/notes.md",
          name: "notes.md",
          mimeType: "text/markdown",
          size: 42,
        },
      ],
    ]);

    fake.releaseNext();
    await prompt;
  });

  it("rejects non-turn-end effective delivery until a transport implements it", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-unsupported-delivery",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const prompt = manager.prompt({
      session_id: "sess-unsupported-delivery",
      turn_id: "turn-steer",
      text: "steer now",
      prompt_intent: "steer",
      requested_delivery: "llm_boundary",
      effective_delivery: "llm_boundary",
    });
    await prompt;

    expect(fake.prompts).toEqual([]);
    expect(events).toContainEqual({
      type: "session.error",
      session_id: "sess-unsupported-delivery",
      turn_id: "turn-steer",
      message: "delivery llm_boundary is not supported by this ACP transport",
    });
  });

  it("persists streamed ACP events before the turn completes", async () => {
    const fake = createStreamingAcpSession([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "partial output" },
      },
    ]);
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-stream-durable",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const prompt = manager.prompt({
      session_id: "sess-stream-durable",
      turn_id: "turn-stream",
      text: "stream please",
    });

    await vi.waitUntil(() =>
      events.some((event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: string }).type === "session.event",
      ),
    );

    expect(vi.mocked(appendEvent)).toHaveBeenCalledWith(
      "sess-stream-durable",
      "agent_message_chunk",
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "partial output" },
      },
    );
    expect(vi.mocked(appendEventsTx)).not.toHaveBeenCalledWith(
      "sess-stream-durable",
      expect.arrayContaining([
        expect.objectContaining({ type: "agent_message_chunk" }),
      ]),
    );

    fake.release();
    await prompt;
  });
});

function createControllableAcpSession(opts: {
  promptCapabilities?: AcpSession["promptCapabilities"];
} = {}): {
  session: AcpSession;
  prompts: unknown[];
  releaseNext: () => void;
} {
  const prompts: unknown[] = [];
  const releases: Array<() => void> = [];
  const session: AcpSession = {
    id: "runtime-session",
    acpSessionId: "acp-session",
    options: {} as SessionOptions,
    authMethods: [],
    agentInfo: null,
    configOptions: [],
    prompt(input: string | readonly unknown[]): AsyncIterable<unknown> {
      prompts.push(typeof input === "string" ? input : [...input]);
      let release!: () => void;
      const done = new Promise<void>((resolve) => {
        release = resolve;
      });
      releases.push(release);
      return (async function* () {
        await done;
      })();
    },
    async setConfigOption() {
      return [];
    },
    async authenticate() {
      return;
    },
    async setMode() {
      return;
    },
    promptCapabilities: opts.promptCapabilities ?? {},
    isAlive() {
      return true;
    },
    async dispose() {
      return;
    },
  };

  return {
    session,
    prompts,
    releaseNext: () => {
      const release = releases.shift();
      if (!release) throw new Error("no prompt waiting");
      release();
    },
  };
}

function createStreamingAcpSession(events: unknown[]): {
  session: AcpSession;
  release: () => void;
} {
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session: AcpSession = {
    id: "runtime-session",
    acpSessionId: "acp-session",
    options: {} as SessionOptions,
    authMethods: [],
    agentInfo: null,
    configOptions: [],
    prompt(): AsyncIterable<unknown> {
      return (async function* () {
        for (const event of events) yield event;
        await done;
      })();
    },
    async setConfigOption() {
      return [];
    },
    async authenticate() {
      return;
    },
    async setMode() {
      return;
    },
    promptCapabilities: {},
    isAlive() {
      return true;
    },
    async dispose() {
      return;
    },
  };
  return { session, release };
}
