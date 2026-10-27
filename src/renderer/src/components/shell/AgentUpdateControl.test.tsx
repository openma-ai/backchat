/**
 * @vitest-environment happy-dom
 */
import { createElement, type ComponentType } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateState } from "@shared/app-update";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

vi.mock("@/lib/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");
  return {
    ...actual,
    useI18n: () => ({
      locale: "en" as const,
      t: (
        key: Parameters<typeof actual.translate>[1],
        values?: Record<string, string | number>,
      ) => actual.translate("en", key, values),
    }),
  };
});

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => null,
  patchSettings: vi.fn(async () => undefined),
}));

import * as updateControl from "./AgentUpdateControl";
import { AgentUpdateControl } from "./AgentUpdateControl";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function appState(overrides: Partial<AppUpdateState> = {}): AppUpdateState {
  return {
    version: "1.0.0",
    channel: "stable",
    build: 0,
    commit: "",
    signed: true,
    status: "idle",
    canInstall: true,
    installBlock: "none",
    available: null,
    errorCode: null,
    checkedAt: null,
    progress: null,
    ...overrides,
  };
}

let current = appState();

const backchat = {
  updateGetState: vi.fn(async () => current),
  updateCheck: vi.fn(async () => current),
  updateDownload: vi.fn(async () => current),
  updateInstall: vi.fn(async () => current),
  onUpdateState: vi.fn(() => () => undefined),
  agentsList: vi.fn(async () => []),
  onAgentsChanged: vi.fn(() => () => undefined),
};

(window as unknown as { backchat: typeof backchat }).backchat = backchat;

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

async function mount(node: React.ReactNode): Promise<Root> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    );
  });
  return root;
}

async function openPopover(): Promise<void> {
  const trigger = document.body.querySelector(
    '[data-sidebar-agent-update-control="true"]',
  );
  if (!trigger) throw new Error("missing trigger");
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("AgentUpdateControl", () => {
  beforeEach(() => {
    current = appState();
    for (const mock of Object.values(backchat)) {
      if (typeof mock === "function" && "mockClear" in mock) mock.mockClear();
    }
    document.body.innerHTML = "";
  });

  it("shows an unknown-length npm update as a spinner instead of fake progress", () => {
    const UpdateAction = (
      updateControl as unknown as {
        AgentUpdateAction?: ComponentType<{
          actionLabel: string;
          error?: string;
          retryLabel: string;
          updateLabel: string;
          updating: boolean;
          updatingLabel: string;
          onUpgrade: () => void;
        }>;
      }
    ).AgentUpdateAction;

    expect(UpdateAction).toBeTypeOf("function");
    if (!UpdateAction) return;

    const html = renderToStaticMarkup(createElement(UpdateAction, {
      actionLabel: "Updating Codex",
      retryLabel: "Retry",
      updateLabel: "Update",
      updating: true,
      updatingLabel: "Updating",
      onUpgrade: () => undefined,
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Updating Codex"');
    expect(html).toContain('data-agent-update-spinner="true"');
    expect(html).toContain("animate-spin");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("data-agent-update-progress");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("[ ... ]");
  });

  it("summarizes a disk-space failure and keeps the raw command in collapsed details", () => {
    const UpdateError = (
      updateControl as unknown as {
        AgentUpdateError?: ComponentType<{
          detailsLabel: string;
          diskSpaceMessage: string;
          error: string;
          fallbackMessage: string;
        }>;
      }
    ).AgentUpdateError;

    expect(UpdateError).toBeTypeOf("function");
    if (!UpdateError) return;

    const rawError = "npm ERR! code ENOSPC\nnpm install --prefix /Users/test/.oma/acp/registry";
    const html = renderToStaticMarkup(createElement(UpdateError, {
      detailsLabel: "Error details",
      diskSpaceMessage: "Not enough disk space. Free up space, then retry.",
      error: rawError,
      fallbackMessage: "Update failed. Please try again.",
    }));

    expect(html).toContain("Not enough disk space. Free up space, then retry.");
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Error details");
    expect(html.indexOf("npm ERR! code ENOSPC")).toBeGreaterThan(
      html.indexOf("<details"),
    );
  });

  it("shows the App update next to the agent updates and downloads it on demand", async () => {
    current = appState({
      status: "available",
      available: { version: "1.1.0", build: 0, commit: "" },
    });
    await mount(
      <AgentUpdateControl
        agents={[
          {
            id: "codex",
            label: "Codex",
            command: "codex",
            detected: true,
            available: true,
            installed: true,
            updateAvailable: true,
          },
        ] as never}
      />,
    );

    await openPopover();

    const appSection = document.body.querySelector('[data-sidebar-app-update="true"]');
    expect(appSection).not.toBeNull();
    expect(
      document.body
        .querySelector("[data-sidebar-app-update-status]")
        ?.getAttribute("data-sidebar-app-update-status"),
    ).toBe("updateAvailable");

    const download = document.body.querySelector('[data-sidebar-app-download="true"]');
    expect(download).not.toBeNull();
    expect(download?.textContent).toContain("Download update");

    await act(async () => {
      download?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(backchat.updateDownload).toHaveBeenCalledTimes(1);
    expect(backchat.updateCheck).not.toHaveBeenCalled();
    expect(backchat.updateInstall).not.toHaveBeenCalled();
  });

  it("offers a restart once the App update is downloaded", async () => {
    current = appState({
      status: "ready",
      available: { version: "1.1.0", build: 0, commit: "" },
    });
    await mount(<AgentUpdateControl agents={[]} />);

    await openPopover();

    const restart = document.body.querySelector('[data-sidebar-app-restart="true"]');
    expect(restart).not.toBeNull();
    expect(document.body.querySelector('[data-sidebar-app-download="true"]')).toBeNull();

    await act(async () => {
      restart?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(backchat.updateInstall).toHaveBeenCalledTimes(1);
    expect(backchat.updateDownload).not.toHaveBeenCalled();
  });

  it("checks without downloading when no update is known", async () => {
    await mount(
      <AgentUpdateControl
        agents={[
          {
            id: "codex",
            label: "Codex",
            command: "codex",
            detected: true,
            available: true,
            installed: true,
            updateAvailable: true,
          },
        ] as never}
      />,
    );

    await openPopover();

    const check = document.body.querySelector('[data-sidebar-app-check="true"]');
    expect(check).not.toBeNull();

    await act(async () => {
      check?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(backchat.updateCheck).toHaveBeenCalledTimes(1);
    expect(backchat.updateDownload).not.toHaveBeenCalled();
  });

  it("renders a real progress bar while the App update downloads", async () => {
    current = appState({
      status: "downloading",
      available: { version: "1.1.0", build: 0, commit: "" },
      progress: { percent: 42, transferred: 420, total: 1000, bytesPerSecond: 4096 },
    });
    await mount(
      <AgentUpdateControl
        agents={[
          {
            id: "codex",
            label: "Codex",
            command: "codex",
            detected: true,
            available: true,
            installed: true,
            updateAvailable: true,
          },
        ] as never}
      />,
    );

    await openPopover();

    const bar = document.body.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("aria-valuenow")).toBe("42");
  });
});
