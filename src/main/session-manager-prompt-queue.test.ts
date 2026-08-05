import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeStartMock = vi.fn();
const probeAgentAuthStatusMock = vi.fn(async () => ({ status: "configured" }));

vi.mock("@open-managed-agents-desktop/acp", () => ({
  AcpRuntimeImpl: class {
    start = runtimeStartMock;
  },
}));

vi.mock("@open-managed-agents-desktop/acp/node-spawner", () => ({
  NodeSpawner: class {},
}));

vi.mock("@open-managed-agents-desktop/acp/registry", () => ({
  resolveKnownAgent: vi.fn(() => ({
    id: "fake-agent",
    label: "Fake Agent",
    spec: { command: "node" },
  })),
}));

vi.mock("@open-managed-agents-desktop/acp/binary-update", () => ({
  ensureLatestAcpBinary: vi.fn(async () => undefined),
}));

vi.mock("@open-managed-agents-desktop/acp/installer", () => ({
  installAcpRegistryAgent: vi.fn(async () => ({ commandPath: "/tmp/backchat-acp-bin/fake-agent" })),
}));

vi.mock("@open-managed-agents-desktop/acp/probe", () => ({
  probeAgentAuthStatus: probeAgentAuthStatusMock,
}));

vi.mock("./session-cwd.js", () => ({
  ensureSessionCwd: vi.fn(async () => "/tmp/backchat-session"),
  removeSessionCwd: vi.fn(async () => undefined),
}));

vi.mock("./sql-store.js", () => ({
  appendEvent: vi.fn(),
  appendEventsTx: vi.fn(),
  archiveSession: vi.fn(),
  setSessionTitle: vi.fn(),
  setSessionTitleIfEmpty: vi.fn(),
  touchSession: vi.fn(),
  upsertSession: vi.fn(),
}));

const { SessionManager } = await import("./session-manager.js");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

async function waitMicrotask(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SessionManager prompt queue", () => {
  beforeEach(() => {
    runtimeStartMock.mockReset();
    probeAgentAuthStatusMock.mockClear();
  });

  it("queues a second prompt until the active turn completes", async () => {
    const send = vi.fn();
    const firstPromptDone = deferred();
    const prompt = vi.fn(async function* (_text: string) {
      await firstPromptDone.promise;
    });
    runtimeStartMock.mockResolvedValue({
      acpSessionId: "acp-queue",
      configOptions: [],
      prompt,
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      isAlive: vi.fn(() => true),
      dispose: vi.fn(),
    });

    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "fake-agent" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({ session_id: "session-queue", agent_id: "fake-agent" });
    const first = manager.prompt({
      session_id: "session-queue",
      turn_id: "turn-1",
      text: "first",
    });
    await waitMicrotask();

    const second = manager.prompt({
      session_id: "session-queue",
      turn_id: "turn-2",
      text: "second",
    });
    await waitMicrotask();

    expect(prompt).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "session.queue_update",
      session_id: "session-queue",
      active_turn_id: "turn-1",
      queued: [expect.objectContaining({ turn_id: "turn-2", text: "second" })],
    }));

    firstPromptDone.resolve();
    await first;
    await second;

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveBeenNthCalledWith(
      2,
      [{ type: "text", text: "second" }],
      expect.any(Object),
    );
  });

  it("executes one edited queued turn with the latest submitted content", async () => {
    const send = vi.fn();
    const firstPromptDone = deferred();
    const prompt = vi.fn(async function* (blocks: Array<{ type: string; text?: string }>) {
      if (blocks.some((block) => block.text === "first")) {
        await firstPromptDone.promise;
      }
    });
    runtimeStartMock.mockResolvedValue({
      acpSessionId: "acp-queue-edit",
      configOptions: [],
      prompt,
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      isAlive: vi.fn(() => true),
      dispose: vi.fn(),
    });

    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "fake-agent" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({ session_id: "session-queue-edit", agent_id: "fake-agent" });
    const first = manager.prompt({
      session_id: "session-queue-edit",
      turn_id: "turn-1",
      text: "first",
    });
    await waitMicrotask();
    const queued = manager.prompt({
      session_id: "session-queue-edit",
      turn_id: "turn-2",
      text: "old follow-up",
    });
    const edited = manager.prompt({
      session_id: "session-queue-edit",
      turn_id: "turn-2",
      text: "edited follow-up",
    });

    firstPromptDone.resolve();
    await Promise.all([first, queued, edited]);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));

    expect(prompt).toHaveBeenNthCalledWith(
      2,
      [{ type: "text", text: "edited follow-up" }],
      expect.any(Object),
    );
  });

  it("injects a selected queued turn through negotiated steering while preserving FIFO drain", async () => {
    const send = vi.fn();
    const firstPromptDone = deferred();
    const thirdPromptDone = deferred();
    const prompt = vi.fn(async function* (blocks: Array<{ type: string; text?: string }>) {
      const text = blocks.find((block) => block.type === "text")?.text;
      if (text === "first") await firstPromptDone.promise;
      if (text === "third") await thirdPromptDone.promise;
    });
    const steer = vi.fn(async () => "injected" as const);
    runtimeStartMock.mockResolvedValue({
      acpSessionId: "acp-queue-steer",
      configOptions: [],
      prompt,
      steer,
      supportsSteering: true,
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      isAlive: vi.fn(() => true),
      dispose: vi.fn(),
    });

    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "fake-agent" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({ session_id: "session-queue-steer", agent_id: "fake-agent" });
    const first = manager.prompt({
      session_id: "session-queue-steer",
      turn_id: "turn-1",
      text: "first",
    });
    await waitMicrotask();
    const steered = manager.prompt({
      session_id: "session-queue-steer",
      turn_id: "turn-2",
      text: "steer now",
    });
    const third = manager.prompt({
      session_id: "session-queue-steer",
      turn_id: "turn-3",
      text: "third",
    });
    await waitMicrotask();

    (manager.updatePromptQueue as (command: unknown) => void)({
      session_id: "session-queue-steer",
      action: "steer",
      turn_id: "turn-2",
    });
    await vi.waitFor(() => expect(steer).toHaveBeenCalledOnce());
    expect(steer).toHaveBeenCalledWith([
      { type: "text", text: "steer now" },
    ]);
    expect(prompt).toHaveBeenCalledOnce();
    await steered;
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "session.queue_update",
      session_id: "session-queue-steer",
      active_turn_id: "turn-1",
      queued: [expect.objectContaining({ turn_id: "turn-3" })],
    }));

    firstPromptDone.resolve();
    await first;
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(prompt).toHaveBeenNthCalledWith(
      2,
      [{ type: "text", text: "third" }],
      expect.any(Object),
    );

    thirdPromptDone.resolve();
    await third;
  });

  it("edits, removes, and reorders the real pending queue before it drains", async () => {
    const send = vi.fn();
    const firstPromptDone = deferred();
    const prompt = vi.fn(async function* (blocks: Array<{ type: string; text?: string }>) {
      if (blocks.some((block) => block.text === "first")) {
        await firstPromptDone.promise;
      }
    });
    runtimeStartMock.mockResolvedValue({
      acpSessionId: "acp-queue-manage",
      configOptions: [],
      prompt,
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      isAlive: vi.fn(() => true),
      dispose: vi.fn(),
    });

    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "fake-agent" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({ session_id: "session-queue-manage", agent_id: "fake-agent" });
    const first = manager.prompt({
      session_id: "session-queue-manage",
      turn_id: "turn-1",
      text: "first",
    });
    await waitMicrotask();
    const second = manager.prompt({
      session_id: "session-queue-manage",
      turn_id: "turn-2",
      text: "remove me",
    });
    const third = manager.prompt({
      session_id: "session-queue-manage",
      turn_id: "turn-3",
      text: "edit me",
    });

    const updatePromptQueue = (manager as unknown as {
      updatePromptQueue?: (command: Record<string, unknown>) => void;
    }).updatePromptQueue;
    expect(typeof updatePromptQueue).toBe("function");
    updatePromptQueue!.call(manager, {
      session_id: "session-queue-manage",
      action: "reorder",
      turn_ids: ["turn-3", "turn-2"],
    });
    updatePromptQueue!.call(manager, {
      session_id: "session-queue-manage",
      action: "update",
      turn_id: "turn-3",
      text: "edited third",
    });
    updatePromptQueue!.call(manager, {
      session_id: "session-queue-manage",
      action: "remove",
      turn_id: "turn-2",
    });

    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "session.queue_update",
      queued: [expect.objectContaining({ turn_id: "turn-3", text: "edited third" })],
    }));

    firstPromptDone.resolve();
    await Promise.all([first, second, third]);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(prompt).toHaveBeenNthCalledWith(
      2,
      [{ type: "text", text: "edited third" }],
      expect.any(Object),
    );
  });

  it("re-announces the authoritative queue snapshot after a renderer reload", async () => {
    const send = vi.fn();
    const firstPromptDone = deferred();
    const prompt = vi.fn(async function* (blocks: Array<{ type: string; text?: string }>) {
      if (blocks.some((block) => block.text === "first")) {
        await firstPromptDone.promise;
      }
    });
    runtimeStartMock.mockResolvedValue({
      acpSessionId: "acp-queue-announce",
      configOptions: [],
      prompt,
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      isAlive: vi.fn(() => true),
      dispose: vi.fn(),
    });
    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({}),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({ session_id: "session-queue-announce", agent_id: "fake-agent" });
    const first = manager.prompt({
      session_id: "session-queue-announce",
      turn_id: "turn-1",
      text: "first",
    });
    await waitMicrotask();
    const second = manager.prompt({
      session_id: "session-queue-announce",
      turn_id: "turn-2",
      text: "queued after reload",
    });
    send.mockClear();

    manager.announceAll();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "session.queue_update",
      session_id: "session-queue-announce",
      active_turn_id: "turn-1",
      queued: [expect.objectContaining({ turn_id: "turn-2" })],
    }));

    firstPromptDone.resolve();
    await Promise.all([first, second]);
  });

  it("still queues running follow-ups when prompt queue is disabled in settings", async () => {
    const send = vi.fn();
    const firstPromptDone = deferred();
    const prompt = vi.fn(async function* (_text: string) {
      await firstPromptDone.promise;
    });
    runtimeStartMock.mockResolvedValue({
      acpSessionId: "acp-queue-disabled",
      configOptions: [],
      prompt,
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      isAlive: vi.fn(() => true),
      dispose: vi.fn(),
    });

    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({
        agentId: "fake-agent",
        promptQueueEnabled: false,
      } as never),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({ session_id: "session-no-queue", agent_id: "fake-agent" });
    const first = manager.prompt({
      session_id: "session-no-queue",
      turn_id: "turn-1",
      text: "first",
    });
    await waitMicrotask();
    const second = manager.prompt({
      session_id: "session-no-queue",
      turn_id: "turn-2",
      text: "second",
    });
    await waitMicrotask();

    expect(prompt).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "session.queue_update",
      session_id: "session-no-queue",
      active_turn_id: "turn-1",
      queued: [expect.objectContaining({ turn_id: "turn-2", text: "second" })],
    }));

    firstPromptDone.resolve();
    await first;
    await second;

    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("drops queued prompts and emits no turn lifecycle after disposal", async () => {
    const send = vi.fn();
    const firstPromptDone = deferred();
    const prompt = vi.fn(async function* () {
      await firstPromptDone.promise;
    });
    runtimeStartMock.mockResolvedValue({
      acpSessionId: "acp-dispose-queue",
      configOptions: [],
      prompt,
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      isAlive: vi.fn(() => true),
      dispose: vi.fn(),
    });
    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({}),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "session-dispose-queue",
      agent_id: "fake-agent",
    });
    const first = manager.prompt({
      session_id: "session-dispose-queue",
      turn_id: "turn-1",
      text: "first",
    });
    await waitMicrotask();
    const second = manager.prompt({
      session_id: "session-dispose-queue",
      turn_id: "turn-2",
      text: "second",
    });
    await waitMicrotask();

    await manager.dispose("session-dispose-queue");
    send.mockClear();
    firstPromptDone.resolve();
    await Promise.all([first, second]);

    expect(prompt).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringMatching(/^session\.(complete|error|queue_update)$/),
      }),
    );
  });
});
