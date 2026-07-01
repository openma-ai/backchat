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
}));

const { createAgentSetupService } = await import("./agent-setup.js");

describe("agent setup lifecycle", () => {
  beforeEach(() => {
    authenticateAgentMock.mockReset();
    probeAgentAuthStatusMock.mockReset();
    uninstallAcpRegistryAgentMock.mockReset();
  });

  it("keeps auth metadata after an external sign-in flow has been launched", async () => {
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

    expect(probeAgentAuthStatusMock).toHaveBeenCalledOnce();
    expect(agents[0]).toMatchObject({
      id: "fake-agent",
      auth: {
        status: "needs-auth",
        methodId: "login",
        methodName: "Login",
      },
    });
  });

  it("uses settings env overrides when probing agent auth", async () => {
    let probedEnv: Record<string, string> | undefined;
    probeAgentAuthStatusMock.mockImplementation(async ({ agent }) => {
      probedEnv = agent.env;
      return { status: "configured" };
    });

    const service = createAgentSetupService({
      acpBinDir: "/tmp/backchat-acp-bin",
      acpInstallRoot: "/tmp/backchat-acp-root",
      registryCachePath: "/tmp/backchat-registry.json",
      agentOverrides: () => [{
        id: "fake-agent",
        env: [{ name: "OPENAI_API_KEY", value: "sk-test" }],
      }],
    } as never);

    await service.probeAgent("fake-agent");

    expect(probeAgentAuthStatusMock).toHaveBeenCalledOnce();
    expect(probedEnv).toMatchObject({ OPENAI_API_KEY: "sk-test" });
  });

  it("rejects setting a needs-auth agent as default", async () => {
    const saveDefaultAgentId = vi.fn();
    probeAgentAuthStatusMock.mockResolvedValue({
      status: "needs-auth",
      methodId: "login",
      methodName: "Login",
      message: "Sign in first.",
      methods: [{ id: "login", name: "Login", type: "agent" }],
    });

    const service = createAgentSetupService({
      acpBinDir: "/tmp/backchat-acp-bin",
      acpInstallRoot: "/tmp/backchat-acp-root",
      registryCachePath: "/tmp/backchat-registry.json",
      saveDefaultAgentId,
    } as never);

    await expect((service as never as { setDefaultAgent: (id: string) => Promise<unknown> })
      .setDefaultAgent("fake-agent")).rejects.toThrow(/Authenticate Fake Agent before setting as default/);
    expect(saveDefaultAgentId).not.toHaveBeenCalled();
  });

  it("persists configured agents as the default", async () => {
    const saveDefaultAgentId = vi.fn();
    probeAgentAuthStatusMock.mockResolvedValue({ status: "configured" });

    const service = createAgentSetupService({
      acpBinDir: "/tmp/backchat-acp-bin",
      acpInstallRoot: "/tmp/backchat-acp-root",
      registryCachePath: "/tmp/backchat-registry.json",
      saveDefaultAgentId,
    } as never);

    await (service as never as { setDefaultAgent: (id: string) => Promise<unknown> })
      .setDefaultAgent("fake-agent");

    expect(saveDefaultAgentId).toHaveBeenCalledWith("fake-agent");
  });

  it("clears the default when uninstalling the selected managed agent", async () => {
    const saveDefaultAgentId = vi.fn();
    const service = createAgentSetupService({
      acpBinDir: "/tmp/backchat-acp-bin",
      acpInstallRoot: "/tmp/backchat-acp-root",
      registryCachePath: "/tmp/backchat-registry.json",
      getDefaultAgentId: () => "fake-agent",
      saveDefaultAgentId,
    } as never);

    await service.uninstallAgent("fake-agent");

    expect(uninstallAcpRegistryAgentMock).toHaveBeenCalledOnce();
    expect(saveDefaultAgentId).toHaveBeenCalledWith("");
  });

  it("warms up available agents by probing auth state", async () => {
    probeAgentAuthStatusMock.mockResolvedValue({ status: "configured" });
    const service = createAgentSetupService({
      acpBinDir: "/tmp/backchat-acp-bin",
      acpInstallRoot: "/tmp/backchat-acp-root",
      registryCachePath: "/tmp/backchat-registry.json",
    });

    await (service as never as { warmup: () => Promise<void> }).warmup();

    expect(probeAgentAuthStatusMock).toHaveBeenCalledOnce();
  });
});
