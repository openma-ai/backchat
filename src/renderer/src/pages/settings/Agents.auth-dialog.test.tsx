/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AgentInfo } from "@shared/api";
import type { Settings } from "@shared/settings";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";

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
  agents: [],
  mcp_servers: [],
} as Settings;

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => settings,
  getSettings: () => settings,
  patchSettings: async () => undefined,
}));

import { SettingsAgents } from "./Agents";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const terminal = { id: "terminal-login", name: "Log in with pi", type: "terminal" as const };
const anthropic = { id: "anthropic", name: "Sign in to Anthropic", type: "agent" as const };
const deepseek = {
  id: "deepseek",
  name: "DeepSeek API key",
  type: "agent" as const,
  form: "fields" as const,
  vars: [{ name: "api-key", label: "API key", secret: true }],
};
const dshKey = {
  id: "api-key",
  name: "API Key",
  type: "agent" as const,
  form: "fields" as const,
  vars: [{ name: "api-key", label: "API key", secret: true }],
};

function agent(partial: Partial<AgentInfo> & Pick<AgentInfo, "id" | "label">): AgentInfo {
  return {
    command: partial.id,
    detected: true,
    available: true,
    installed: true,
    ...partial,
  };
}

function catalog(): AgentInfo[] {
  return [
    agent({
      id: "pi-acp",
      label: "pi",
      auth: {
        status: "needs-auth",
        message: "Authentication required.",
        methodId: "terminal-login",
        supportsLogout: true,
        methods: [terminal, anthropic, deepseek],
      },
    }),
    agent({
      id: "dsh-acp",
      label: "DeepSeek Harness",
      auth: {
        status: "needs-auth",
        message: "Authentication required.",
        supportsLogout: true,
        methods: [dshKey],
      },
    }),
    agent({
      id: "codex-acp",
      label: "Codex",
      auth: {
        status: "configured",
        message: "Authentication configured.",
        supportsLogout: true,
        methods: [anthropic],
      },
    }),
    agent({
      id: "update-agent",
      label: "Update Agent",
      installed: true,
      updateAvailable: true,
      installedVersion: "1.0.0",
      latestVersion: "2.0.0",
    }),
    agent({
      id: "missing-agent",
      label: "Missing Agent",
      available: false,
      detected: false,
      installed: false,
      installable: true,
    }),
    agent({
      id: "env-agent",
      label: "Env Agent",
      auth: {
        status: "needs-auth",
        message: "Missing credential variable: OPENAI_API_KEY.",
        methodId: "openai-env",
        methods: [{
          id: "openai-env",
          name: "OpenAI environment",
          type: "env_var",
          vars: [{ name: "OPENAI_API_KEY", secret: true }],
        }],
      },
    }),
  ];
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let agents: AgentInfo[] = [];
let authenticate: Mock<(input: unknown) => Promise<AgentInfo[]>>;
let logout: Mock<(input: unknown) => Promise<AgentInfo[]>>;
let install: Mock<(id: string) => Promise<AgentInfo[]>>;
let upgrade: Mock<(id: string) => Promise<AgentInfo[]>>;
let uninstall: Mock<(id: string) => Promise<AgentInfo[]>>;

function installBackchat(): void {
  const api = {
    agentsList: async () => agents,
    agentAuthenticate: (input: unknown) => authenticate(input),
    agentLogout: (input: unknown) => logout(input),
    agentInstall: (id: string) => install(id),
    agentUpgrade: (id: string) => upgrade(id),
    agentUninstall: (id: string) => uninstall(id),
    settingsGet: async () => settings,
    onSettingsChanged: () => () => undefined,
  };
  window.backchat = new Proxy(api, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      if (typeof prop === "string" && prop.startsWith("on")) return () => () => undefined;
      return () => Promise.resolve(undefined);
    },
  }) as unknown as typeof window.backchat;
}

async function mount(): Promise<{ root: Root; client: QueryClient }> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(AGENTS_QUERY_KEY, agents);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SettingsAgents />
      </QueryClientProvider>,
    );
  });
  return { root, client };
}

function button(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((node) =>
    node.textContent?.trim() === label || node.getAttribute("aria-label") === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`missing button ${label}`);
  return match;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    button(label).click();
  });
}

async function clickNode(node: Element): Promise<void> {
  await act(async () => {
    if (node instanceof HTMLElement) node.click();
  });
}

describe("Settings agent auth dialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    agents = catalog();
    authenticate = vi.fn(async () => agents);
    logout = vi.fn(async () => agents);
    install = vi.fn(async () => agents);
    upgrade = vi.fn(async () => agents);
    uninstall = vi.fn(async () => agents);
    installBackchat();
  });

  it("keeps an auth failure on the agent that caused it", async () => {
    const view = await mount();
    await click("Sign in to pi");
    await clickNode(document.body.querySelector("[data-auth-method='deepseek']")!);
    const input = document.body.querySelector("[data-auth-field='api-key']") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "sk-rejected");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const gate = deferred<AgentInfo[]>();
    authenticate.mockImplementationOnce(() => gate.promise);
    await click("Save");
    gate.reject(new Error("The API key was rejected."));
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("The API key was rejected.");

    const retry = deferred<AgentInfo[]>();
    authenticate.mockImplementationOnce(() => retry.promise);
    await click("Save");
    expect(document.body.textContent).not.toContain("The API key was rejected.");
    retry.reject("plain auth");
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("plain auth");

    await click("Close");
    await click("Sign in to DeepSeek Harness");
    expect(document.body.querySelector("[data-auth-setup-dialog]")?.textContent).not.toContain("plain auth");
    expect(document.body.querySelector("[data-auth-setup-dialog]")?.textContent).not.toContain("The API key was rejected.");
    await act(async () => view.root.unmount());
  });

  it("closes after a terminal launch and after configuration, and logs out only when signed in", async () => {
    const view = await mount();
    expect(button("Switch account for Codex")).toBeTruthy();
    expect(document.body.querySelector("button[aria-label='Switch account for pi']")).toBeNull();

    await click("Switch account for Codex");
    expect(document.body.textContent).toContain("Log out");
    logout.mockResolvedValueOnce(agents.map((item) => item.id === "codex-acp"
      ? { ...item, auth: { ...item.auth!, status: "needs-auth" as const, message: "Logged out." } }
      : item));
    await click("Log out");
    expect(document.body.querySelector("[data-auth-setup-dialog]")).not.toBeNull();
    await click("Close");

    const terminalGate = deferred<AgentInfo[]>();
    authenticate.mockImplementationOnce(() => terminalGate.promise);
    await click("Sign in to pi");
    await clickNode(document.body.querySelector("[data-auth-method='terminal-login']")!);
    await click("Open terminal setup");
    await click("Close");
    terminalGate.resolve(agents);
    await act(async () => {
      await terminalGate.promise;
    });
    expect(document.body.querySelector("[data-auth-setup-dialog]")).toBeNull();

    authenticate.mockResolvedValueOnce(agents);
    await click("Open pi setup again");
    await clickNode(document.body.querySelector("[data-auth-method='anthropic']")!);
    await click("Continue sign in");
    expect(document.body.querySelector("[data-auth-setup-dialog]")).not.toBeNull();
    expect(document.body.textContent).toContain("Waiting for auth");
    expect(document.body.textContent).toContain("Continue sign in");

    view.client.setQueryData(AGENTS_QUERY_KEY, agents.map((item) => item.id === "pi-acp"
      ? { ...item, auth: { ...item.auth!, status: "configured" as const, message: "Authentication configured." } }
      : item));
    await act(async () => {
      view.root.render(
        <QueryClientProvider client={view.client}>
          <SettingsAgents />
        </QueryClientProvider>,
      );
    });
    expect(document.body.textContent).toContain("Log out");
    const logoutGate = deferred<AgentInfo[]>();
    logout.mockImplementationOnce(() => logoutGate.promise);
    await click("Log out");
    logoutGate.reject("logged out badly");
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("logged out badly");
    logout.mockResolvedValueOnce(agents);
    await click("Log out");
    expect(document.body.textContent).not.toContain("logged out badly");

    authenticate.mockReset();
    authenticate.mockResolvedValue(agents.map((item) => item.id === "dsh-acp"
      ? { ...item, auth: { ...item.auth!, status: "configured" as const, message: "Authentication configured." } }
      : item));
    await click("Sign in to DeepSeek Harness");
    const key = document.body.querySelector("[data-auth-field='api-key']") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(key, "sk-ok");
      key.dispatchEvent(new Event("input", { bubbles: true }));
      key.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = document.body.querySelector("[data-auth-submit]") as HTMLButtonElement;
    if (!save || save.disabled) throw new Error(`save disabled with value ${key?.value}`);
    await clickNode(save);
    expect(document.body.querySelector("[data-auth-setup-dialog]")).toBeNull();

    const opener = ["Sign in to pi", "Open pi setup again", "Open pi sign in again", "Configure Env Agent credentials"]
      .map((label) => document.body.querySelector(`button[aria-label='${label}']`))
      .find((node) => node instanceof HTMLButtonElement);
    if (!(opener instanceof HTMLButtonElement)) {
      throw new Error([...document.body.querySelectorAll("button")].map((node) => node.getAttribute("aria-label") || node.textContent?.trim()).join(" | "));
    }
    await click(opener.getAttribute("aria-label")!);
    install.mockRejectedValueOnce(new Error("install failed"));
    await click("Install");
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("install failed");
    expect(document.body.querySelector("[data-auth-setup-dialog]")?.textContent).not.toContain("install failed");
    await click("Close");

    const enable = document.body.querySelector("[aria-label='Enable Codex']");
    if (!(enable instanceof HTMLElement)) throw new Error("missing enable checkbox");
    await act(async () => { enable.click(); });
    await click("Configure Env Agent credentials");
    await click("Save");

    install.mockResolvedValueOnce(agents);
    upgrade.mockResolvedValueOnce(agents);
    uninstall.mockResolvedValueOnce(agents);
    await click("Install");
    await click("Upgrade");
    await click("Uninstall Update Agent");
    await click("Check again");
    await act(async () => view.root.unmount());
  });
});
