import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeEntry = {
  id: "fake-agent",
  label: "Fake Agent",
  spec: { command: "/tmp/fake-agent" },
  registryId: "fake-agent",
  installSource: "registry" as const,
};

const authenticateAgentMock = vi.fn();
const probeAgentAuthStatusMock = vi.fn();
const probeAgentSessionConfigMock = vi.fn();
const uninstallAcpRegistryAgentMock = vi.fn();

vi.mock("@open-managed-agents-desktop/acp/registry", () => ({
  detect: vi.fn(async () => fakeEntry),
  detectEntry: vi.fn(async (entry) => entry),
  detectAll: vi.fn(async () => [fakeEntry]),
  getKnownAgents: vi.fn(() => [fakeEntry]),
  loadRegistry: vi.fn(async () => [fakeEntry]),
}));

vi.mock("@open-managed-agents-desktop/acp/installer", () => ({
  installAcpRegistryAgent: vi.fn(),
  installManagedAdapter: vi.fn(),
  readAcpRegistryInstallMetadata: vi.fn(async () => null),
  uninstallAcpRegistryAgent: uninstallAcpRegistryAgentMock,
  uninstallManagedAdapter: vi.fn(),
}));

vi.mock("@open-managed-agents-desktop/acp/probe", () => ({
  authenticateAgent: authenticateAgentMock,
  probeAgentAuthStatus: probeAgentAuthStatusMock,
  probeAgentSessionConfig: probeAgentSessionConfigMock,
}));

const { createAgentSetupService } = await import("./agent-setup.js");

describe("agent setup lifecycle", () => {
  beforeEach(() => {
    authenticateAgentMock.mockReset();
    probeAgentAuthStatusMock.mockReset();
    probeAgentSessionConfigMock.mockReset();
    uninstallAcpRegistryAgentMock.mockReset();
  });

  it("does not start a follow-up probe after an external sign-in flow launches", async () => {
    authenticateAgentMock.mockResolvedValue({ status: "started" });
    probeAgentAuthStatusMock.mockResolvedValue({
      status: "needs-auth",
      methodId: "login",
      methodName: "Login",
      methods: [{ id: "login", name: "Login", type: "agent" }],
    });

    const service = createAgentSetupService({
      acpBinDir: "/tmp/backchat-acp-bin",
      acpInstallRoot: "/tmp/backchat-acp-root",
      registryCachePath: "/tmp/backchat-registry.json",
    });

    const agents = await service.authenticateAgent("fake-agent", { methodId: "login" });

    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(agents[0]).toMatchObject({ id: "fake-agent" });
  });

  it("uses settings env overrides during the startup probe", async () => {
    let probedEnv: Record<string, string> | undefined;
    probeAgentSessionConfigMock.mockImplementation(async ({ agent }) => {
      probedEnv = agent.env;
      return {
        configOptions: [],
        availableCommands: [],
        auth: { status: "configured" },
      };
    });

    const service = createAgentSetupService({
      acpBinDir: "/tmp/backchat-acp-bin",
      acpInstallRoot: "/tmp/backchat-acp-root",
      registryCachePath: "/tmp/backchat-registry.json",
      getEnabledAgentIds: () => ["fake-agent"],
      agentOverrides: () => [{
        id: "fake-agent",
        env: [{ name: "OPENAI_API_KEY", value: "sk-test" }],
      }],
    } as never);

    await service.warmup();

    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
    expect(probedEnv).toMatchObject({ OPENAI_API_KEY: "sk-test" });
  });

  it("warms up available agents with one full capability inspection", async () => {
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions: [],
      availableCommands: [],
      auth: { status: "configured" },
    });
    const service = createAgentSetupService({
      acpBinDir: "/tmp/backchat-acp-bin",
      acpInstallRoot: "/tmp/backchat-acp-root",
      registryCachePath: "/tmp/backchat-registry.json",
    });

    await (service as never as { warmup: () => Promise<void> }).warmup();

    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
  });
});
