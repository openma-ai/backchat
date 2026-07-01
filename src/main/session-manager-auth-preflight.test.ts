import { describe, expect, it, vi } from "vitest";

const runtimeStartMock = vi.fn();
const probeAgentAuthStatusMock = vi.fn();

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

describe("SessionManager auth preflight", () => {
  it("reports auth_required before spawning a default agent that now needs auth", async () => {
    const send = vi.fn();
    probeAgentAuthStatusMock.mockResolvedValue({
      status: "needs-auth",
      methodId: "login",
      methodName: "Login",
      message: "Sign in first.",
      methods: [{ id: "login", name: "Login", type: "agent" }],
    });

    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "fake-agent" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({ session_id: "session-auth", agent_id: "fake-agent" });

    expect(runtimeStartMock).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "session.error",
      session_id: "session-auth",
      code: "auth_required",
      agent_id: "fake-agent",
      message: expect.stringContaining("Authenticate Fake Agent before starting"),
    }));
  });
});
