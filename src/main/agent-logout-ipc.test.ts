import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, payload: unknown) => unknown>());
const setup = vi.hoisted(() => ({
  listAgents: vi.fn(async () => [{ id: "listed", label: "Listed", command: "listed", detected: true }]),
  logoutAgent: vi.fn(async (id: string) => [{ id, label: id, command: id, detected: true }]),
  dispose: vi.fn(async () => undefined),
  warmup: vi.fn(async () => undefined),
  observeAuth: vi.fn(async () => ({ status: "needs-auth" as const, message: "logged out" })),
  observeSessionConfig: vi.fn(async () => ({})),
  installAgent: vi.fn(async () => []),
  upgradeAgent: vi.fn(async () => []),
  uninstallAgent: vi.fn(async () => []),
  authenticateAgent: vi.fn(async () => []),
}));

vi.hoisted(() => {
  process.env["BACKCHAT_TEST_HOOKS"] = "1";
  process.env["BACKCHAT_E2E_SKIP_AGENT_WARMUP"] = "1";
  process.env["BACKCHAT_DISABLE_CONTROL"] = "1";
  process.env["BACKCHAT_HOME"] = process.env["BACKCHAT_HOME"] ?? "/tmp";
});

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/tmp/backchat-app",
    getPath: () => "/tmp/backchat-app",
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  Notification: class Notification {
    static isSupported(): boolean {
      return false;
    }
    on(): void {}
    show(): void {}
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  shell: { openExternal: vi.fn(async () => undefined), openPath: vi.fn(async () => "") },
  session: { defaultSession: { on: vi.fn() } },
  webContents: { fromId: () => null, getAllWebContents: () => [] },
}));

vi.mock("./agent-setup.js", () => ({
  createAgentSetupService: () => setup,
  launchTerminalAuth: vi.fn(),
}));

import { InvokeChannel } from "../shared/ipc-channels.js";
import { registerIpc } from "./ipc.js";

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`missing handler ${channel}`);
  return await handler({}, payload) as T;
}

describe("agent logout IPC", () => {
  let dispose: (() => Promise<void>) | undefined;
  let logout: ReturnType<typeof vi.spyOn> | undefined;

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), "backchat-logout-ipc-"));
    process.env["BACKCHAT_HOME"] = home;
    const runtime = await registerIpc({
      registryCachePath: join(home, "registry.json"),
      probeCachePath: join(home, "probe.json"),
      acpBinDir: join(home, "bin"),
      acpInstallRoot: join(home, "acp"),
      scheduleDbPath: join(home, "schedules.sqlite"),
    });
    dispose = () => runtime.dispose();
    logout = vi.spyOn(runtime.sessionManager, "logout");
  }, 30_000);

  afterAll(async () => {
    await dispose?.();
  });

  it("falls through to a one-shot logout when no live session accepts it", async () => {
    logout?.mockImplementation(async () => false);
    await expect(invoke(InvokeChannel.AgentLogout, { id: "pi-acp" })).resolves.toEqual([
      { id: "pi-acp", label: "pi-acp", command: "pi-acp", detected: true },
    ]);
    expect(setup.logoutAgent).toHaveBeenCalledWith("pi-acp");
    expect(logout).not.toHaveBeenCalled();

    await invoke(InvokeChannel.AgentLogout, { id: "pi-acp", sessionId: "missing" });
    expect(logout).toHaveBeenCalledWith("missing");

    logout?.mockImplementation(async () => true);
    setup.listAgents.mockClear();
    setup.logoutAgent.mockClear();
    await expect(invoke(InvokeChannel.AgentLogout, { id: "pi-acp", sessionId: "sess-live" }))
      .resolves.toEqual([{ id: "listed", label: "Listed", command: "listed", detected: true }]);
    expect(setup.listAgents).toHaveBeenCalled();
    expect(setup.logoutAgent).not.toHaveBeenCalled();
  });

  it("records fixture logout only when the agent advertises it", async () => {
    const loggedOut = [{ id: "pi-acp", label: "pi", command: "pi", detected: true, available: true }];
    await invoke(InvokeChannel.TestSetAgentSetupFixture, {
      agents: [{
        id: "pi-acp",
        label: "pi",
        command: "pi",
        detected: true,
        auth: { status: "configured", message: "ready", supportsLogout: true },
      }],
      logoutResults: { "pi-acp": loggedOut },
    });
    await expect(invoke(InvokeChannel.AgentLogout, { id: "pi-acp", sessionId: "sess-1" }))
      .resolves.toEqual(loggedOut);
    await expect(invoke(InvokeChannel.TestAgentSetupCalls)).resolves.toEqual([
      { type: "logout", id: "pi-acp", sessionId: "sess-1" },
    ]);

    await invoke(InvokeChannel.TestSetAgentSetupFixture, {
      agents: [{
        id: "pi-acp",
        label: "pi",
        command: "pi",
        detected: true,
        auth: { status: "configured", message: "ready", supportsLogout: true },
      }],
    });
    await expect(invoke(InvokeChannel.AgentLogout, { id: "pi-acp" })).resolves.toEqual([
      expect.objectContaining({ id: "pi-acp" }),
    ]);

    await invoke(InvokeChannel.TestSetAgentSetupFixture, {
      agents: [{
        id: "pi-acp",
        label: "pi",
        command: "pi",
        detected: true,
        auth: { status: "configured", message: "ready", supportsLogout: false },
      }],
    });
    await expect(invoke(InvokeChannel.AgentLogout, { id: "pi-acp" }))
      .rejects.toThrow(/does not support ACP logout/);

    await invoke(InvokeChannel.TestSetAgentSetupFixture, {
      agents: [{ id: "other", label: "Other", command: "other", detected: true }],
    });
    await expect(invoke(InvokeChannel.AgentLogout, { id: "pi-acp" }))
      .rejects.toThrow(/does not support ACP logout/);

    await invoke(InvokeChannel.TestSetAgentSetupFixture, {
      agents: [{ id: "pi-acp", label: "pi", command: "pi", detected: true }],
    });
    await expect(invoke(InvokeChannel.AgentLogout, { id: "pi-acp" }))
      .rejects.toThrow(/does not support ACP logout/);
  });

  it("can reject a fixture authentication with that agent's error", async () => {
    await invoke(InvokeChannel.TestSetAgentSetupFixture, {
      agents: [{ id: "pi-acp", label: "pi", command: "pi", detected: true }],
      authenticateErrors: { "pi-acp": "The API key was rejected." },
    });
    await expect(invoke(InvokeChannel.AgentAuthenticate, { id: "pi-acp", methodId: "deepseek" }))
      .rejects.toThrow("The API key was rejected.");

    await invoke(InvokeChannel.TestSetAgentSetupFixture, {
      agents: [{ id: "pi-acp", label: "pi", command: "pi", detected: true }],
      authenticateResults: {
        "pi-acp": [{ id: "pi-acp", label: "pi", command: "pi", detected: true, available: true }],
      },
    });
    await expect(invoke(InvokeChannel.AgentAuthenticate, { id: "pi-acp", methodId: "deepseek" }))
      .resolves.toEqual([
        expect.objectContaining({ id: "pi-acp", available: true }),
      ]);
  });
});
