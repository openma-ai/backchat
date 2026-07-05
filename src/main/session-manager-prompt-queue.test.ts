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

  it("runs prompts concurrently when prompt queue is disabled in settings", async () => {
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

    expect(prompt).toHaveBeenCalledTimes(2);

    firstPromptDone.resolve();
    await first;
    await second;
  });
});
