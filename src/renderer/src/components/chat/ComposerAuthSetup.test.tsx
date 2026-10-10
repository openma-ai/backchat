/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInfo } from "@shared/api";
import type { Settings } from "@shared/settings";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";

const harness = vi.hoisted(() => ({
  settings: null as Settings | null,
  agents: [] as AgentInfo[],
  authenticate: vi.fn<(input: { id: string; methodId?: string; values?: Record<string, string> }) => Promise<AgentInfo[]>>(),
  logout: vi.fn<(input: { id: string; sessionId?: string }) => Promise<AgentInfo[]>>(),
  panel: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => harness.settings,
  patchSettings: async () => undefined,
}));

vi.mock("@/pages/settings/AgentSettingsPanels", () => ({
  AgentAuthSetupPanel: (props: Record<string, unknown>) => {
    harness.panel = props;
    return (
      <div data-auth-panel="">
        <div data-error>{String(props.error ?? "")}</div>
        <div data-logout-offered={String(props.supportsLogout === true)} />
        <div data-waiting={String(props.waitingForAuth === true)} />
        <button type="button" data-start onClick={() => (props.onStart as (id?: string, options?: { values?: Record<string, string> }) => void)("deepseek", { values: { "api-key": "sk" } })}>start</button>
        <button type="button" data-logout onClick={() => (props.onLogout as () => void)()}>logout</button>
        <button type="button" data-saved onClick={() => (props.onSaved as () => void)()}>saved</button>
        <button type="button" data-close onClick={() => (props.onClose as () => void)()}>close</button>
      </div>
    );
  },
}));

import { ComposerAuthSetup } from "./ComposerAuthSetup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings = {
  default: { workspace_path: "", permission_mode: "ask" as const, prompt_queue_enabled: true },
  appearance: {
    light_theme_id: "backchat-light",
    dark_theme_id: "backchat-dark",
    theme: "system" as const,
    language: "en" as const,
    font_size: "md" as const,
    density: "default" as const,
  },
  agents: [{ id: "pi-acp", enabled: true, env: [] }],
  mcp_servers: [],
} as Settings;

function pi(status: "configured" | "needs-auth", supportsLogout = true): AgentInfo {
  return {
    id: "pi-acp",
    label: "pi",
    command: "pi-acp",
    detected: true,
    available: true,
    auth: {
      status,
      message: status,
      supportsLogout,
      methods: [{ id: "deepseek", name: "DeepSeek", type: "agent", form: "fields", vars: [{ name: "api-key", secret: true }] }],
    },
  };
}

function installBackchat(): void {
  window.backchat = {
    agentsList: async () => harness.agents,
    agentAuthenticate: (input: { id: string; methodId?: string; values?: Record<string, string> }) => harness.authenticate(input),
    agentLogout: (input: { id: string; sessionId?: string }) => harness.logout(input),
  } as unknown as typeof window.backchat;
}

async function mount(node: ReactNode): Promise<{ root: Root; client: QueryClient }> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(AGENTS_QUERY_KEY, harness.agents);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  return { root, client };
}

async function click(selector: string): Promise<void> {
  const node = document.body.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  await act(async () => {
    node.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ComposerAuthSetup", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    harness.panel = null;
    harness.settings = settings;
    harness.agents = [pi("configured")];
    harness.authenticate.mockReset();
    harness.logout.mockReset();
    installBackchat();
  });

  it("stays closed until settings and an agent are both available", async () => {
    const closed = await mount(<ComposerAuthSetup open={false} sessionAgentId="pi-acp" />);
    expect(document.body.querySelector("[data-auth-panel]")).toBeNull();
    await act(async () => closed.root.unmount());

    harness.settings = null;
    const noSettings = await mount(<ComposerAuthSetup open sessionAgentId="pi-acp" />);
    expect(document.body.querySelector("[data-auth-panel]")).toBeNull();
    await act(async () => noSettings.root.unmount());

    harness.settings = settings;
    harness.agents = [];
    const noAgent = await mount(<ComposerAuthSetup open sessionAgentId="missing" />);
    expect(document.body.querySelector("[data-auth-panel]")).toBeNull();
    await act(async () => noAgent.root.unmount());
  });

  it("logs out through the live session and surfaces both error shapes", async () => {
    harness.logout.mockResolvedValueOnce([pi("needs-auth")]);
    const withSession = await mount(
      <ComposerAuthSetup open sessionId="sess-1" sessionAgentId="pi-acp" sessionSupportsLogout />,
    );
    expect(document.body.querySelector("[data-logout-offered]")?.getAttribute("data-logout-offered")).toBe("true");
    await click("[data-logout]");
    expect(harness.logout).toHaveBeenCalledWith({ id: "pi-acp", sessionId: "sess-1" });
    await act(async () => withSession.root.unmount());

    harness.agents = [pi("needs-auth")];
    const hidden = await mount(
      <ComposerAuthSetup open sessionAgentId="pi-acp" sessionSupportsLogout authRequired />,
    );
    expect(document.body.querySelector("[data-logout-offered]")?.getAttribute("data-logout-offered")).toBe("false");
    await act(async () => hidden.root.unmount());

    harness.agents = [pi("configured", false)];
    const sessionOnly = await mount(
      <ComposerAuthSetup open sessionAgentId="pi-acp" sessionSupportsLogout />,
    );
    expect(document.body.querySelector("[data-logout-offered]")?.getAttribute("data-logout-offered")).toBe("true");
    await act(async () => sessionOnly.root.unmount());

    harness.agents = [pi("configured", false)];
    const neither = await mount(<ComposerAuthSetup open sessionAgentId="pi-acp" />);
    expect(document.body.querySelector("[data-logout-offered]")?.getAttribute("data-logout-offered")).toBe("false");
    await act(async () => neither.root.unmount());

    harness.agents = [pi("configured")];
    harness.logout.mockRejectedValueOnce(new Error("logout failed"));
    const errored = await mount(<ComposerAuthSetup open sessionAgentId="pi-acp" />);
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-logout]")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.querySelector("[data-error]")?.textContent).toContain("logout failed");
    await act(async () => errored.root.unmount());

    harness.logout.mockRejectedValueOnce("plain logout");
    const plain = await mount(<ComposerAuthSetup open sessionAgentId="pi-acp" />);
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-logout]")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.querySelector("[data-error]")?.textContent).toContain("plain logout");
    await act(async () => plain.root.unmount());
  });

  it("finishes configured auth, keeps the dialog for external auth, and reports recovery failures", async () => {
    const onClose = vi.fn();
    const onAuthenticated = vi.fn(async () => undefined);
    harness.authenticate.mockResolvedValueOnce([pi("configured")]);
    const configured = await mount(
      <ComposerAuthSetup
        open
        sessionId="sess-1"
        sessionAgentId="pi-acp"
        onClose={onClose}
        onAuthenticated={onAuthenticated}
      />,
    );
    await click("[data-start]");
    expect(harness.authenticate).toHaveBeenCalledWith({
      id: "pi-acp",
      methodId: "deepseek",
      values: { "api-key": "sk" },
    });
    expect(onAuthenticated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    await act(async () => configured.root.unmount());

    harness.authenticate.mockResolvedValueOnce([pi("needs-auth")]);
    const waiting = await mount(
      <ComposerAuthSetup open sessionAgentId="pi-acp" onClose={onClose} />,
    );
    await click("[data-start]");
    expect(document.body.querySelector("[data-waiting]")?.getAttribute("data-waiting")).toBe("true");
    expect(document.body.querySelector("[data-auth-panel]")).not.toBeNull();
    await act(async () => waiting.root.unmount());

    harness.authenticate.mockRejectedValueOnce(new Error("The API key was rejected."));
    const rejected = await mount(<ComposerAuthSetup open sessionAgentId="pi-acp" />);
    await click("[data-start]");
    expect(document.body.querySelector("[data-error]")?.textContent).toContain("The API key was rejected.");
    expect(document.body.querySelector("[data-waiting]")?.getAttribute("data-waiting")).toBe("false");
    await act(async () => rejected.root.unmount());

    harness.authenticate.mockRejectedValueOnce("plain auth");
    const plain = await mount(<ComposerAuthSetup open sessionAgentId="pi-acp" />);
    await click("[data-start]");
    expect(document.body.querySelector("[data-error]")?.textContent).toContain("plain auth");
    await act(async () => plain.root.unmount());

    const boom = vi.fn(async () => {
      throw new Error("reconnect failed");
    });
    harness.authenticate.mockResolvedValueOnce([pi("configured")]);
    const recovery = await mount(
      <ComposerAuthSetup open sessionAgentId="pi-acp" onAuthenticated={boom} />,
    );
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-start]")?.click();
      await Promise.resolve();
    });
    expect(document.body.querySelector("[data-error]")?.textContent).toContain("reconnect failed");
    await act(async () => recovery.root.unmount());

    harness.authenticate.mockResolvedValueOnce([pi("configured")]);
    const cleared = await mount(
      <ComposerAuthSetup open sessionId="sess-clear" sessionAgentId="pi-acp" onClose={onClose} />,
    );
    await click("[data-saved]");
    expect(onClose).toHaveBeenCalled();
    await act(async () => cleared.root.unmount());
  });
});
