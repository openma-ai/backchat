/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInfo } from "@shared/api";
import type { Settings } from "@shared/settings";

const patchSettings = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");
  return {
    ...actual,
    useI18n: () => ({
      locale: "en" as const,
      t: (key: Parameters<typeof actual.translate>[1], values?: Record<string, string | number>) =>
        actual.translate("en", key, values),
    }),
  };
});

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => null,
  patchSettings,
}));

import { AgentAuthSetupPanel, CustomAgentPanel } from "./AgentSettingsPanels";
import { AgentRow } from "./AgentSettingsRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings = {
  default: {
    workspace_path: "",
    permission_mode: "ask" as const,
    prompt_queue_enabled: true,
  },
  appearance: {
    light_theme_id: "backchat-light",
    dark_theme_id: "backchat-dark",
    theme: "system" as const,
    language: "en" as const,
    font_size: "md" as const,
    density: "default" as const,
  },
  agents: [{
    id: "pi-acp",
    env: [
      { name: "api-key", value: "sk-saved-shared" },
      { name: "OPENAI_API_KEY", value: "sk-openai-saved" },
      { name: "OPENAI_ORG", value: "org-saved" },
    ],
  }],
  mcp_servers: [],
} as Settings;

function methodAgent(methods: NonNullable<NonNullable<AgentInfo["auth"]>["methods"]>, id = "pi-acp"): AgentInfo {
  return {
    id,
    label: id === "pi-acp" ? "pi" : id,
    command: id,
    detected: true,
    available: true,
    auth: {
      status: "needs-auth",
      message: "Authentication required.",
      methodId: methods[0]?.id,
      methods,
    },
  };
}

const terminal = {
  id: "pi-login",
  name: "Log in with pi",
  description: "Open pi in a terminal",
  type: "terminal",
  link: "https://pi.example/login",
};
const anthropic = {
  id: "anthropic",
  name: "Sign in to Anthropic",
  description: "Claude Pro or Max in the browser",
  type: "agent",
};
const deepseek = {
  id: "deepseek",
  name: "DeepSeek API key",
  description: "Stored by the agent",
  type: "agent",
  form: "fields" as const,
  vars: [{ name: "api-key", label: "API key", secret: true }],
};
const openai = {
  id: "openai",
  name: "OpenAI API key",
  description: "Stored by the agent",
  type: "agent",
  form: "fields" as const,
  vars: [{ name: "api-key", label: "API key", secret: true }],
};
const gateway = {
  id: "custom-endpoint",
  name: "Custom gateway",
  description: "OpenAI-compatible endpoint",
  type: "agent",
  form: "fields" as const,
  vars: [
    { name: "baseUrl", label: "Base URL" },
    { name: "api-key", label: "API key", secret: true },
    { name: "providerName", label: "Provider", secret: false, optional: true },
  ],
};
const envMethod = {
  id: "openai-env",
  name: "OpenAI environment",
  type: "env_var",
  vars: [
    { name: "OPENAI_API_KEY", secret: true },
    { name: "OPENAI_ORG", secret: false },
  ],
};

const piMethods = [terminal, anthropic, deepseek, openai, gateway];

function installDomShims(): void {
  Element.prototype.scrollIntoView = () => undefined;
  if (!("hasPointerCapture" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      value: () => false,
    });
  }
  if (!("setPointerCapture" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { value: () => undefined });
  }
  if (!("releasePointerCapture" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { value: () => undefined });
  }
}

async function mount(node: ReactNode): Promise<{ root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return { root };
}

function field(name: string): HTMLInputElement {
  const input = document.body.querySelector(`[data-auth-field="${name}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing field ${name}`);
  return input;
}

function option(id: string): HTMLElement {
  const node = document.body.querySelector(`[data-auth-method="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`missing method ${id}`);
  return node;
}

async function click(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("AgentAuthSetupPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    patchSettings.mockClear();
    installDomShims();
  });

  it("does not submit a secret typed for one api-key method with another method", async () => {
    const onStart = vi.fn();
    const onMethodIdChange = vi.fn();
    await mount(
      <AgentAuthSetupPanel
        agent={methodAgent(piMethods)}
        settings={settings}
        waitingForAuth={false}
        pending={false}
        onMethodIdChange={onMethodIdChange}
        onStart={onStart}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    expect(document.body.querySelector("[data-auth-setup-dialog]")).not.toBeNull();
    expect(document.body.querySelector("[data-auth-method-list]")?.className).toContain("max-h-72");
    expect(document.body.textContent).toContain("Sign in");
    expect(document.body.textContent).toContain("API key");
    expect(document.body.textContent).toContain("Gateway");
    expect(document.body.textContent).toContain("Terminal");
    expect(document.body.querySelector("[data-auth-method-detail]")?.getAttribute("data-auth-method-detail")).toBe("anthropic");
    expect(option("pi-login").getAttribute("data-checked")).toBe("false");
    expect(option("anthropic").getAttribute("data-checked")).toBe("true");
    await click(option("anthropic"));
    expect(onMethodIdChange).toHaveBeenCalledWith("anthropic");
    expect(document.body.textContent).toContain("pi handles sign-in through its ACP authentication flow.");

    await click(option("deepseek"));
    expect(onMethodIdChange).toHaveBeenCalledWith("deepseek");
    expect(field("api-key").value).toBe("");
    expect(field("api-key").type).toBe("password");
    expect(document.body.textContent).toContain("Submitted through ACP authenticate. Backchat does not keep these values.");
    const save = () => document.body.querySelector("[data-auth-submit]") as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await click(save());
    expect(onStart).not.toHaveBeenCalled();

    await typeInto(field("api-key"), "sk-deepseek");
    expect(field("api-key").value).toBe("sk-deepseek");
    await click(option("openai"));
    expect(field("api-key").value).toBe("");
    expect(field("api-key").name).toBe("openai:api-key");
    await typeInto(field("api-key"), "sk-openai");
    await click(save());
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith("openai", { values: { "api-key": "sk-openai" } });
    expect(JSON.stringify(onStart.mock.calls)).not.toContain("sk-deepseek");
  });

  it("keeps the gateway form beside the selected method and surfaces errors", async () => {
    const onStart = vi.fn();
    await mount(
      <AgentAuthSetupPanel
        agent={methodAgent(piMethods)}
        settings={settings}
        waitingForAuth={false}
        pending={false}
        error="The gateway rejected the key."
        onMethodIdChange={() => undefined}
        onStart={onStart}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    await click(option("custom-endpoint"));
    expect(field("baseUrl").type).toBe("text");
    expect(field("api-key").value).toBe("");
    expect(document.body.textContent).toContain("Provider (optional)");
    expect(document.body.textContent).toContain("The gateway rejected the key.");
    const save = document.body.querySelector("[data-auth-submit]") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await typeInto(field("baseUrl"), "https://gateway.example/v1");
    await typeInto(field("api-key"), "sk-gateway");
    await typeInto(field("providerName"), "custom");
    await click(save);
    expect(onStart).toHaveBeenCalledWith("custom-endpoint", {
      values: {
        baseUrl: "https://gateway.example/v1",
        "api-key": "sk-gateway",
        providerName: "custom",
      },
    });
  });

  it("filters the method list and does not carry the previous draft back", async () => {
    await mount(
      <AgentAuthSetupPanel
        agent={methodAgent(piMethods)}
        settings={settings}
        waitingForAuth={false}
        pending={false}
        onMethodIdChange={() => undefined}
        onStart={() => undefined}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    const search = document.body.querySelector("input[aria-label='Search authentication methods']") as HTMLInputElement;
    await typeInto(search, "deepseek");
    expect(document.body.querySelector("[data-auth-method='deepseek']")).not.toBeNull();
    expect(document.body.querySelector("[data-auth-method='openai']")).toBeNull();
    expect(document.body.querySelector("[data-auth-method='pi-login']")).toBeNull();
    await typeInto(search, "no-such-method");
    expect(document.body.textContent).toContain("No matching methods.");
  });

  it("starts terminal setup without a secret and offers logout through ACP", async () => {
    const onStart = vi.fn();
    const onLogout = vi.fn();
    const onClose = vi.fn();
    await mount(
      <AgentAuthSetupPanel
        agent={methodAgent(piMethods)}
        settings={settings}
        waitingForAuth={false}
        pending={false}
        supportsLogout
        onLogout={onLogout}
        onMethodIdChange={() => undefined}
        onStart={onStart}
        onClose={onClose}
        onSaved={() => undefined}
      />,
    );
    expect(document.body.querySelector("a[href='https://pi.example/login']")).toBeNull();
    await click(option("pi-login"));
    expect(document.body.textContent).toContain("pi manages credentials in its own terminal setup.");
    expect(document.body.querySelector("a[href='https://pi.example/login']")?.textContent).toContain("Credential source");
    await click(document.body.querySelector("[data-auth-submit]") as HTMLButtonElement);
    expect(onStart).toHaveBeenCalledWith("pi-login");
    await click(document.body.querySelector("[data-auth-logout]") as HTMLButtonElement);
    expect(onLogout).toHaveBeenCalledTimes(1);
    await click(document.body.querySelector("[data-auth-dismiss]") as HTMLButtonElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    const close = document.body.querySelector("[data-slot='dialog-close']");
    if (close) await click(close);
    expect(onClose.mock.calls.length).toBeGreaterThan(1);
  });

  it("shows the waiting terminal action and ignores dismiss while a request is pending", async () => {
    const onClose = vi.fn();
    const onMethodIdChange = vi.fn();
    await mount(
      <AgentAuthSetupPanel
        agent={methodAgent(piMethods)}
        settings={settings}
        waitingForAuth
        pending
        onMethodIdChange={onMethodIdChange}
        onStart={() => undefined}
        onClose={onClose}
        onSaved={() => undefined}
      />,
    );
    await click(option("pi-login"));
    expect(onMethodIdChange).not.toHaveBeenCalled();
    expect(document.body.querySelector("[data-auth-submit]")?.textContent).toContain("Opening…");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await act(async () => undefined);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("saves an env-var method from its own variables and continues a single browser method", async () => {
    const onSaved = vi.fn();
    const envView = await mount(
      <AgentAuthSetupPanel
        agent={methodAgent([envMethod])}
        settings={settings}
        waitingForAuth={false}
        pending={false}
        onMethodIdChange={() => undefined}
        onStart={() => undefined}
        onClose={() => undefined}
        onSaved={onSaved}
      />,
    );
    expect(document.body.querySelector("[data-auth-method-list]")).toBeNull();
    expect(field("OPENAI_API_KEY").type).toBe("password");
    expect(field("OPENAI_API_KEY").value).toBe("sk-openai-saved");
    expect(field("OPENAI_ORG").type).toBe("text");
    expect(field("OPENAI_ORG").value).toBe("org-saved");
    expect(document.body.textContent).toContain("local environment override");
    await typeInto(field("OPENAI_API_KEY"), "sk-replaced");
    await click(document.body.querySelector("[data-auth-submit]") as HTMLButtonElement);
    expect(patchSettings).toHaveBeenCalledWith({
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: "pi-acp",
          env: expect.arrayContaining([
            { name: "OPENAI_API_KEY", value: "sk-replaced" },
            { name: "OPENAI_ORG", value: "org-saved" },
          ]),
        }),
      ]),
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    await act(async () => envView.root.unmount());

    const onStart = vi.fn();
    const single = await mount(
      <AgentAuthSetupPanel
        agent={methodAgent([{ ...anthropic, description: undefined }], "claude")}
        settings={{ ...settings, agents: [] }}
        waitingForAuth
        pending={false}
        supportsLogout
        logoutPending
        onMethodIdChange={() => undefined}
        onStart={onStart}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    expect(document.body.querySelector("[data-auth-method-list]")).toBeNull();
    expect(document.body.textContent).toContain("Finish setup outside OpenMA.");
    expect(document.body.querySelector("[data-auth-submit]")?.textContent).toContain("Continue sign in");
    expect(document.body.querySelector("[data-auth-logout]")?.textContent).toContain("Logging out…");
    const logout = document.body.querySelector("[data-auth-logout]") as HTMLButtonElement;
    expect(logout.disabled).toBe(true);
    expect((document.body.querySelector("[data-auth-submit]") as HTMLButtonElement).disabled).toBe(true);
    await click(document.body.querySelector("[data-auth-submit]") as HTMLButtonElement);
    expect(onStart).not.toHaveBeenCalled();
    await act(async () => single.root.unmount());

    const bare = await mount(
      <AgentAuthSetupPanel
        agent={methodAgent([], "empty-agent")}
        settings={settings}
        waitingForAuth={false}
        pending={false}
        supportsLogout
        onMethodIdChange={() => undefined}
        onStart={() => undefined}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    expect(document.body.textContent).toContain("This agent did not advertise an authentication method.");
    expect(document.body.querySelector("[data-auth-submit]")).toBeNull();
    expect((document.body.querySelector("[data-auth-logout]") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => bare.root.unmount());

    const saving = await mount(
      <AgentAuthSetupPanel
        agent={methodAgent([deepseek])}
        settings={settings}
        waitingForAuth={false}
        pending
        onMethodIdChange={() => undefined}
        onStart={() => undefined}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    expect(document.body.querySelector("[data-auth-submit]")?.textContent).toContain("Saving…");
    await act(async () => saving.root.unmount());

    const again = await mount(
      <AgentAuthSetupPanel
        agent={methodAgent([terminal])}
        settings={settings}
        waitingForAuth
        pending={false}
        onMethodIdChange={() => undefined}
        onStart={() => undefined}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    expect(document.body.querySelector("[data-auth-submit]")?.textContent).toContain("Open setup again");
    expect(document.body.textContent).toContain("Finish setup outside OpenMA.");
    await act(async () => again.root.unmount());

    await mount(
      <AgentAuthSetupPanel
        agent={{
          ...methodAgent([]),
          auth: { status: "needs-auth", message: "Missing methods." },
        }}
        settings={settings}
        waitingForAuth={false}
        pending={false}
        onMethodIdChange={() => undefined}
        onStart={() => undefined}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    expect(document.body.textContent).toContain("This agent did not advertise an authentication method.");
  });

  it("edits a custom agent command", async () => {
    const onChange = vi.fn();
    const onCancel = vi.fn();
    const onSave = vi.fn();
    await mount(
      <CustomAgentPanel
        value={{ id: "studio", label: "Studio", command: "studio", argsText: "--acp", envText: "TOKEN=1" }}
        onChange={onChange}
        onCancel={onCancel}
        onSave={onSave}
      />,
    );
    const inputs = [...document.body.querySelectorAll("input, textarea")] as Array<HTMLInputElement | HTMLTextAreaElement>;
    for (const input of inputs) {
      await typeInto(input as HTMLInputElement, `${input.value}-x`);
    }
    expect(onChange).toHaveBeenCalled();
    const buttons = [...document.body.querySelectorAll("button")];
    await click(buttons.find((button) => button.textContent === "Cancel")!);
    await click(buttons.find((button) => button.textContent === "Save and check")!);
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalled();
  });

  it("offers switch account on a configured agent that advertises ACP logout", async () => {
    const configured = {
      ...methodAgent([anthropic]),
      auth: {
        status: "configured" as const,
        message: "Authentication configured.",
        supportsLogout: true,
        methods: [anthropic],
      },
    };
    const onOpenSetup = vi.fn();
    const idle = await mount(
      <AgentRow
        agent={configured}
        enabled
        waitingForAuth={false}
        activeActions={[]}
        onSetEnabled={() => undefined}
        onInstall={() => undefined}
        onUpgrade={() => undefined}
        onUninstall={() => undefined}
        onOpenSetup={onOpenSetup}
      />,
    );
    const button = document.body.querySelector("button[aria-label='Switch account for pi']") as HTMLButtonElement;
    expect(button).not.toBeNull();
    await click(button);
    expect(onOpenSetup).toHaveBeenCalled();
    await act(async () => idle.root.unmount());

    await mount(
      <AgentRow
        agent={configured}
        enabled
        waitingForAuth={false}
        activeActions={[{ type: "logout", id: "pi-acp" }]}
        onSetEnabled={() => undefined}
        onInstall={() => undefined}
        onUpgrade={() => undefined}
        onUninstall={() => undefined}
        onOpenSetup={() => undefined}
      />,
    );
    expect(document.body.textContent).toContain("Logging out…");
    expect((document.body.querySelector("button[aria-label='Switch account for pi']") as HTMLButtonElement).disabled).toBe(true);
  });
});
