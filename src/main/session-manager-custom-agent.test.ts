import { describe, expect, it, vi } from "vitest";

const runtimeStartMock = vi.fn();
const upsertSessionMock = vi.fn();
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
  resolveKnownAgent: vi.fn(() => null),
}));

vi.mock("@open-managed-agents-desktop/acp/binary-update", () => ({
  ensureLatestAcpBinary: vi.fn(async () => undefined),
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
  upsertSession: upsertSessionMock,
}));

const { SessionManager } = await import("./session-manager.js");

describe("SessionManager custom ACP agents", () => {
  it("starts an unknown agent id when settings provide a command override", async () => {
    const send = vi.fn();
    runtimeStartMock.mockResolvedValue({
      acpSessionId: "acp-1",
      configOptions: [],
      prompt: vi.fn(),
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      isAlive: vi.fn(() => true),
      dispose: vi.fn(),
    });

    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "studio" }),
      resolveAgentOverride: () => ({
        labelOverride: "Studio ACP",
        commandOverride: "node",
        argsOverride: ["studio-acp", "--serve"],
        envOverride: { STUDIO_TOKEN: "secret" },
      }),
    });

    await manager.start({ session_id: "session-1", agent_id: "studio" });

    expect(runtimeStartMock).toHaveBeenCalledWith(expect.objectContaining({
      agent: expect.objectContaining({
        command: "node",
        args: ["studio-acp", "--serve"],
        env: expect.objectContaining({ STUDIO_TOKEN: "secret" }),
      }),
    }));
    expect(upsertSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      id: "session-1",
      agent_id: "studio",
      acp_session_id: "acp-1",
    }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "session.ready",
      session_id: "session-1",
      agent_id: "studio",
    }));
  });
});
