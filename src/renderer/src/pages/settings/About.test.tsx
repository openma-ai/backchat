/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateState } from "@shared/app-update";

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

import { SettingsAbout } from "./About";

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

async function mount(node: ReactNode): Promise<Root> {
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

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`);
}

function click(node: HTMLElement | null): void {
  if (!node) throw new Error("missing element");
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Settings → About update flow", () => {
  beforeEach(() => {
    current = appState();
    for (const mock of Object.values(backchat)) {
      if (typeof mock === "function" && "mockClear" in mock) mock.mockClear();
    }
    document.body.innerHTML = "";
  });

  it("checks for updates without downloading anything", async () => {
    await mount(<SettingsAbout />);

    click(byTestId("update-check-button"));

    expect(backchat.updateCheck).toHaveBeenCalledTimes(1);
    expect(backchat.updateDownload).not.toHaveBeenCalled();
    expect(backchat.updateInstall).not.toHaveBeenCalled();
  });

  it("offers a download only once a check found an update", async () => {
    await mount(<SettingsAbout />);
    expect(byTestId("update-download-button")).toBeNull();

    current = appState({
      status: "available",
      available: { version: "1.1.0", build: 0, commit: "" },
    });
    const root = await mount(<SettingsAbout />);

    const download = byTestId("update-download-button");
    expect(download).not.toBeNull();
    click(download);

    expect(backchat.updateDownload).toHaveBeenCalledTimes(1);
    expect(backchat.updateInstall).not.toHaveBeenCalled();
    expect(backchat.updateCheck).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("offers a restart only once the update is downloaded", async () => {
    current = appState({
      status: "ready",
      available: { version: "1.1.0", build: 0, commit: "" },
    });
    await mount(<SettingsAbout />);

    expect(byTestId("update-download-button")).toBeNull();
    const restart = byTestId("update-restart-button");
    expect(restart).not.toBeNull();

    click(restart);

    expect(backchat.updateInstall).toHaveBeenCalledTimes(1);
    expect(backchat.updateDownload).not.toHaveBeenCalled();
  });

  it("shows a real progress bar while the update downloads", async () => {
    current = appState({
      status: "downloading",
      available: { version: "1.1.0", build: 0, commit: "" },
      progress: { percent: 42, transferred: 420, total: 1000, bytesPerSecond: 4096 },
    });
    await mount(<SettingsAbout />);

    const bar = document.body.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("aria-valuenow")).toBe("42");
    expect(bar?.getAttribute("aria-valuemin")).toBe("0");
    expect(bar?.getAttribute("aria-valuemax")).toBe("100");
    expect(document.body.textContent).toContain("42%");
  });

  it("reports the App and the agents in one shared vocabulary", async () => {
    backchat.agentsList.mockResolvedValue([
      {
        id: "codex",
        label: "Codex",
        command: "codex",
        detected: true,
        available: true,
        installed: true,
        updateAvailable: true,
      },
    ] as never);

    await mount(<SettingsAbout />);

    const appRow = byTestId("update-app-row");
    const agentsRow = byTestId("update-agents-row");
    expect(appRow).not.toBeNull();
    expect(agentsRow).not.toBeNull();
    expect(agentsRow?.getAttribute("data-update-status")).toBe("updateAvailable");
    expect(agentsRow?.textContent).toContain("1 agent updates available.");
  });

  it("keeps an idle page from claiming a lonely up-to-date line", async () => {
    await mount(<SettingsAbout />);

    const appRow = byTestId("update-app-row");
    expect(appRow?.getAttribute("data-update-status")).toBe("idle");
    expect(appRow?.textContent).toContain("Idle");
    // The managed-agent row is present even when nothing needs updating.
    expect(byTestId("update-agents-row")).not.toBeNull();
  });
});
