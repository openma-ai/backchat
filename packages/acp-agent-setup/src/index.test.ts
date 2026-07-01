import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeEntry = {
  id: "fake-agent",
  label: "Fake Agent",
  spec: { command: "/tmp/fake-agent" },
  registryId: "fake-agent",
  installSource: "registry" as const,
};

const probeAgentAuthStatusMock = vi.fn();
const probeAgentConfigOptionsMock = vi.fn();

vi.mock("@open-managed-agents-desktop/acp/registry", () => ({
  detectEntry: vi.fn(async (entry) => entry),
  getKnownAgents: vi.fn(() => [fakeEntry]),
  loadRegistry: vi.fn(async () => [fakeEntry]),
}));

vi.mock("@open-managed-agents-desktop/acp/installer", () => ({
  installAcpRegistryAgent: vi.fn(),
  installManagedAdapter: vi.fn(),
  readAcpRegistryInstallMetadata: vi.fn(async () => null),
  uninstallAcpRegistryAgent: vi.fn(),
  uninstallManagedAdapter: vi.fn(),
}));

vi.mock("@open-managed-agents-desktop/acp/probe", () => ({
  authenticateAgent: vi.fn(),
  probeAgentConfigOptions: probeAgentConfigOptionsMock,
  probeAgentAuthStatus: probeAgentAuthStatusMock,
}));

const { createAcpAgentSetupService } = await import("./index.js");

describe("acp agent setup sdk", () => {
  beforeEach(() => {
    probeAgentAuthStatusMock.mockReset();
    probeAgentConfigOptionsMock.mockReset();
  });

  it("accepts host-independent env record overrides for auth probes", async () => {
    let probedEnv: Record<string, string> | undefined;
    probeAgentAuthStatusMock.mockImplementation(async ({ agent }) => {
      probedEnv = agent.env;
      return { status: "configured" };
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
      agentOverrides: () => [{
        id: "fake-agent",
        env: { OPENAI_API_KEY: "sk-test" },
      }],
    });

    await service.probeAgent("fake-agent");

    expect(probeAgentAuthStatusMock).toHaveBeenCalledOnce();
    expect(probedEnv).toMatchObject({ OPENAI_API_KEY: "sk-test" });
  });

  it("can live-probe config options for setup surfaces without changing default list behavior", async () => {
    const configOptions = [{
      id: "model",
      name: "Model",
      type: "select",
      category: "model",
      currentValue: "gpt-test",
      options: [{ value: "gpt-test", name: "GPT Test" }],
    }];
    probeAgentConfigOptionsMock.mockResolvedValue(configOptions);

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
    });

    expect((await service.listAgents())[0]?.config_options).toBeUndefined();

    const agents = await service.listAgents({ probeConfigOptions: true });

    expect(probeAgentConfigOptionsMock).toHaveBeenCalledOnce();
    expect(agents[0]?.config_options).toEqual(configOptions);
  });

  it("skips live config probing when an auth probe says the agent needs authentication", async () => {
    probeAgentAuthStatusMock.mockResolvedValue({
      status: "needs-auth",
      methodId: "login",
      methodName: "Login",
      methods: [{ id: "login", name: "Login", type: "agent" }],
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
    });

    const agents = await service.listAgents({ probeAuth: true, probeConfigOptions: true });

    expect(probeAgentAuthStatusMock).toHaveBeenCalledOnce();
    expect(probeAgentConfigOptionsMock).not.toHaveBeenCalled();
    expect(agents[0]?.auth?.status).toBe("needs-auth");
    expect(agents[0]?.config_options).toBeUndefined();
  });
});
