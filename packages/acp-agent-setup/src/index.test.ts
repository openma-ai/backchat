import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeEntry = {
  id: "fake-agent",
  label: "Fake Agent",
  spec: { command: "/tmp/fake-agent" },
  registryId: "fake-agent",
  installSource: "registry" as const,
  icon: "https://registry.example/fake-agent.svg",
};

const probeAgentAuthStatusMock = vi.fn();
const probeAgentSessionConfigMock = vi.fn();
const authenticateAgentMock = vi.fn();
const installAcpRegistryAgentMock = vi.fn();
const readAcpRegistryInstallMetadataMock = vi.fn(async () => null as { version?: string } | null);

vi.mock("@open-managed-agents-desktop/acp/registry", () => ({
  detectEntry: vi.fn(async (entry) => entry),
  getKnownAgents: vi.fn(() => [fakeEntry]),
  loadRegistry: vi.fn(async () => [fakeEntry]),
}));

vi.mock("@open-managed-agents-desktop/acp/installer", () => ({
  installAcpRegistryAgent: installAcpRegistryAgentMock,
  installManagedAdapter: vi.fn(),
  readAcpRegistryInstallMetadata: readAcpRegistryInstallMetadataMock,
  uninstallAcpRegistryAgent: vi.fn(),
  uninstallManagedAdapter: vi.fn(),
}));

vi.mock("@open-managed-agents-desktop/acp/probe", () => ({
  authenticateAgent: authenticateAgentMock,
  probeAgentSessionConfig: probeAgentSessionConfigMock,
  probeAgentAuthStatus: probeAgentAuthStatusMock,
}));

const { createAcpAgentSetupService } = await import("./index.js");

describe("acp agent setup sdk", () => {
  beforeEach(() => {
    probeAgentAuthStatusMock.mockReset();
    probeAgentSessionConfigMock.mockReset();
    authenticateAgentMock.mockReset();
    installAcpRegistryAgentMock.mockReset();
    readAcpRegistryInstallMetadataMock.mockReset();
    readAcpRegistryInstallMetadataMock.mockResolvedValue(null);
  });

  it("accepts host-independent env record overrides for capability inspection", async () => {
    let probedEnv: Record<string, string> | undefined;
    probeAgentSessionConfigMock.mockImplementation(async ({ agent }) => {
      probedEnv = agent.env;
      return {
        configOptions: [],
        availableCommands: [],
        auth: { status: "configured" },
      };
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
      probeCachePath: join(
        tmpdir(),
        `sdk-probe-env-${process.pid}-${Date.now()}.json`,
      ),
      agentOverrides: () => [{
        id: "fake-agent",
        env: { OPENAI_API_KEY: "sk-test" },
      }],
      getEnabledAgentIds: () => ["fake-agent"],
    });

    await service.refreshEnabledAgents();

    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
    expect(probedEnv).toMatchObject({ OPENAI_API_KEY: "sk-test" });
    const spawnEnv = probeAgentSessionConfigMock.mock.calls[0]?.[0]?.env;
    expect(spawnEnv).toHaveProperty("CLAUDECODE");
    expect(spawnEnv?.CLAUDECODE).toBeUndefined();
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
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions,
      availableCommands: [],
      auth: { status: "configured" },
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
      probeCachePath: join(
        tmpdir(),
        `sdk-probe-config-${process.pid}-${Date.now()}.json`,
      ),
      getEnabledAgentIds: () => ["fake-agent"],
    });

    expect((await service.listAgents())[0]?.config_options).toBeUndefined();

    const agents = await service.refreshEnabledAgents();

    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
    expect(agents[0]?.config_options).toEqual(configOptions);
    expect(agents[0]?.icon).toBe("https://registry.example/fake-agent.svg");
  });

  it("returns the auth gate from the same full capability process", async () => {
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions: [],
      availableCommands: [],
      auth: {
        status: "needs-auth",
        methodId: "login",
        methodName: "Login",
        methods: [{ id: "login", name: "Login", type: "agent" }],
      },
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
      probeCachePath: join(
        tmpdir(),
        `sdk-probe-auth-block-${process.pid}-${Date.now()}.json`,
      ),
      getEnabledAgentIds: () => ["fake-agent"],
    });

    const agents = await service.refreshEnabledAgents();

    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
    expect(agents[0]?.auth?.status).toBe("needs-auth");
    expect(agents[0]?.config_options).toBeUndefined();
  });

  it("probes auth and config options for the newly installed agent", async () => {
    const configOptions = [{
      id: "model",
      name: "Model",
      type: "select",
      category: "model",
      currentValue: "test-model",
      options: [{ value: "test-model", name: "Test Model" }],
    }];
    probeAgentAuthStatusMock.mockResolvedValue({ status: "configured" });
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions,
      availableCommands: [],
      auth: { status: "configured" },
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
      probeCachePath: join(
        tmpdir(),
        `sdk-probe-install-${process.pid}-${Date.now()}.json`,
      ),
    });

    const agents = await service.installAgent("fake-agent");

    expect(installAcpRegistryAgentMock).toHaveBeenCalledOnce();
    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
    expect(agents[0]?.config_options).toEqual(configOptions);
  });

  it("persists installed agent session metadata for ordinary lists after restart", async () => {
    const root = join(tmpdir(), `openma-acp-probe-cache-${process.pid}-${Date.now()}`);
    const configOptions = [{
      id: "model",
      name: "Model",
      type: "select",
      currentValue: "test-model",
      options: [{ value: "test-model", name: "Test Model" }],
    }];
    const availableCommands = [{
      name: "compact",
      description: "Compact the current context",
    }];
    const modes = {
      currentModeId: "medium",
      availableModes: [{ id: "medium", name: "Medium" }],
    };
    probeAgentAuthStatusMock.mockResolvedValue({ status: "configured" });
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions,
      availableCommands,
      modes,
      auth: { status: "configured" },
    });

    const deps = {
      acpBinDir: join(root, "bin"),
      acpInstallRoot: join(root, "acp"),
      registryCachePath: join(root, "registry.json"),
      probeCachePath: join(root, "probe-cache.json"),
    };
    await mkdir(deps.acpBinDir, { recursive: true });

    const installingService = createAcpAgentSetupService(deps);
    const installed = await installingService.installAgent("fake-agent");
    const restartedService = createAcpAgentSetupService(deps);
    const restored = await restartedService.listAgents();

    expect(installed[0]?.config_options).toEqual(configOptions);
    expect(installed[0]?.available_commands).toEqual(availableCommands);
    expect(installed[0]?.session_modes).toEqual(modes);
    expect(restored[0]?.config_options).toEqual(configOptions);
    expect(restored[0]?.available_commands).toEqual(availableCommands);
    expect(restored[0]?.session_modes).toEqual(modes);
    await rm(root, { recursive: true, force: true });
  });

  it("uses a manual agent probe to refresh session config and slash commands", async () => {
    const root = join(tmpdir(), `openma-acp-manual-probe-${process.pid}-${Date.now()}`);
    const configOptions = [{
      id: "model",
      name: "Model",
      type: "select",
      currentValue: "test-model",
      options: [{ value: "test-model", name: "Test Model" }],
    }];
    const availableCommands = [{ name: "compact" }];
    probeAgentAuthStatusMock.mockResolvedValue({ status: "configured" });
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions,
      availableCommands,
      auth: { status: "configured" },
    });

    const service = createAcpAgentSetupService({
      acpBinDir: join(root, "bin"),
      acpInstallRoot: join(root, "acp"),
      registryCachePath: join(root, "registry.json"),
      probeCachePath: join(root, "probe-cache.json"),
      getEnabledAgentIds: () => ["fake-agent"],
    });
    const agents = await service.refreshEnabledAgents();

    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
    expect(agents[0]?.config_options).toEqual(configOptions);
    expect(agents[0]?.available_commands).toEqual(availableCommands);
    await rm(root, { recursive: true, force: true });
  });

  it("full-inspects detected agents at cold start even when none are enabled", async () => {
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions: [],
      availableCommands: [],
      auth: { status: "configured" },
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
    });

    await service.warmup();
    const agents = await service.listAgents();

    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
    expect(agents[0]?.auth?.status).toBe("configured");
  });

  it("reports a failed cold-start capability inspection as degraded instead of empty", async () => {
    const root = join(
      tmpdir(),
      `sdk-probe-degraded-${process.pid}-${Date.now()}`,
    );
    probeAgentSessionConfigMock.mockRejectedValue(
      new Error("session/new failed"),
    );

    const service = createAcpAgentSetupService({
      acpBinDir: join(root, "bin"),
      acpInstallRoot: join(root, "acp"),
      registryCachePath: join(root, "registry.json"),
      probeCachePath: join(root, "probe-cache.json"),
    });

    await service.warmup();
    const agents = await service.listAgents();

    expect(agents[0]?.capability_inspection).toEqual({
      status: "degraded",
      error: "session/new failed",
      inspected_at: expect.any(String),
    });
    expect(agents[0]?.config_options).toBeUndefined();
    expect(agents[0]?.available_commands).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  it("reports a completed cold-start capability inspection as ready", async () => {
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions: [{ id: "model", options: [{ value: "model-a" }] }],
      availableCommands: [{ name: "status" }],
      modes: { currentModeId: "agent", availableModes: [] },
      auth: { status: "configured" },
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
    });

    await service.warmup();
    const agents = await service.listAgents();

    expect(agents[0]?.capability_inspection).toEqual({
      status: "ready",
      inspected_at: expect.any(String),
    });
  });

  it("retains the latest probed auth state for the next ordinary list", async () => {
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions: [],
      availableCommands: [],
      auth: {
        status: "needs-auth",
        methodId: "terminal-login",
        methods: [{ id: "terminal-login", name: "Terminal setup", type: "terminal" }],
      },
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: "/tmp/sdk-registry.json",
    });

    await service.warmup();
    const agents = await service.listAgents();

    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
    expect(agents[0]?.auth).toMatchObject({
      status: "needs-auth",
      methodId: "terminal-login",
    });
  });

  it("records completed authentication without a follow-up capability probe", async () => {
    authenticateAgentMock.mockResolvedValue({ status: "completed" });
    probeAgentAuthStatusMock.mockResolvedValue({ status: "configured" });
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions: [{
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "authenticated-model",
        options: [{ value: "authenticated-model", name: "Authenticated Model" }],
      }],
      availableCommands: [{ name: "status" }],
    });

    const service = createAcpAgentSetupService({
      acpBinDir: "/tmp/sdk-acp-bin",
      acpInstallRoot: "/tmp/sdk-acp-root",
      registryCachePath: join(
        tmpdir(),
        `sdk-post-auth-${process.pid}-${Date.now()}.json`,
      ),
    });

    const agents = await service.authenticateAgent("fake-agent", { methodId: "login" });

    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(probeAgentSessionConfigMock).not.toHaveBeenCalled();
    expect(agents[0]?.auth).toMatchObject({
      status: "configured",
      methodId: "login",
    });
  });

  it("warms up every detected agent capability inspection in parallel", async () => {
    const root = join(tmpdir(), `openma-acp-warmup-${process.pid}-${Date.now()}`);
    const started: string[] = [];
    const finishers: Array<() => void> = [];
    probeAgentAuthStatusMock.mockResolvedValue({ status: "configured" });
    probeAgentSessionConfigMock.mockImplementation(({ agent }) => new Promise((resolve) => {
      started.push(agent.command);
      finishers.push(() => resolve({
        configOptions: [{
          id: "model",
          name: "Model",
          type: "select",
          currentValue: agent.command,
          options: [{ value: agent.command, name: agent.command }],
        }],
        availableCommands: [],
        auth: { status: "configured" },
      }));
    }));

    const service = createAcpAgentSetupService({
      acpBinDir: join(root, "bin"),
      acpInstallRoot: join(root, "acp"),
      registryCachePath: join(root, "registry.json"),
      probeCachePath: join(root, "probe-cache.json"),
      agentOverrides: () => [{
        id: "second-agent",
        label: "Second Agent",
        command: "/tmp/second-agent",
      }],
      // Startup capability discovery is inventory-driven. A detected agent
      // must be inspected even when it is not currently enabled for chats.
      getEnabledAgentIds: () => ["fake-agent"],
    });

    const warmup = service.warmup();
    await vi.waitFor(() => {
      expect(started).toEqual(expect.arrayContaining([
        "/tmp/fake-agent",
        "/tmp/second-agent",
      ]));
    });
    finishers.forEach((finish) => finish());
    await warmup;

    expect(probeAgentSessionConfigMock).toHaveBeenCalledTimes(2);
    await rm(root, { recursive: true, force: true });
  });

  it("refreshes auth and capabilities after upgrading an agent", async () => {
    const root = join(tmpdir(), `openma-acp-setup-upgrade-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "fake-agent"), "#!/bin/sh\n", { mode: 0o755 });
    readAcpRegistryInstallMetadataMock.mockResolvedValue({ version: "1.0.0" });
    probeAgentAuthStatusMock.mockResolvedValue({ status: "configured" });
    probeAgentSessionConfigMock.mockResolvedValue({
      configOptions: [],
      availableCommands: [{ name: "new-command" }],
      auth: { status: "configured" },
    });
    const refreshRegistry = vi.fn(async () => {});

    const service = createAcpAgentSetupService({
      acpBinDir: binDir,
      acpInstallRoot: root,
      registryCachePath: join(root, "registry.json"),
      refreshRegistry,
    });

    await expect(service.upgradeAgent("fake-agent")).resolves.toEqual([
      expect.objectContaining({ id: "fake-agent", available: true, installed: true }),
    ]);
    expect(installAcpRegistryAgentMock).toHaveBeenCalledOnce();
    expect(probeAgentAuthStatusMock).not.toHaveBeenCalled();
    expect(probeAgentSessionConfigMock).toHaveBeenCalledOnce();
    expect(refreshRegistry).toHaveBeenCalledWith({ refresh: false });
    await rm(root, { recursive: true, force: true });
  });
});
