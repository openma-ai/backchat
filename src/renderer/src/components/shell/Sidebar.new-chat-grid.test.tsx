/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    locale: "en" as const,
    t: (key: string) =>
      ({
        "sidebar.newChat": "New chat",
        "sidebar.search": "Search",
        "sidebar.sidebarOptions": "Sidebar options",
        "sidebar.newSection": "New section",
        "sidebar.scheduled": "Scheduled",
        "sidebar.settings": "Settings",
      })[key] ?? key,
  }),
}));

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

vi.mock("@/components/chat/RuntimeLocationControl", () => ({
  RuntimeLocationControl: () => (
    <div data-testid="sidebar-local-runtime-row" className="sidebar-grid-row" data-sidebar-grid="row">
      <span data-sidebar-grid="icon" />
    </div>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    className,
    children,
    ...props
  }: {
    to: string;
    className?: string;
    children?: ReactNode;
  } & Record<string, unknown>) => (
    <a href={to} className={className} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => () => undefined,
}));

import { Sidebar } from "./Sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installBackchat(): void {
  const api = new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop.startsWith("on")) return () => () => undefined;
      return async () => [];
    },
  });
  window.backchat = api as unknown as typeof window.backchat;
}

async function mount(): Promise<{ root: Root; host: HTMLDivElement }> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Sidebar />
      </QueryClientProvider>,
    );
  });
  return { root, host };
}

describe("new chat sidebar grid", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installBackchat();
  });

  it("keeps the new chat icon cell on the shared grid inside the primary control", async () => {
    const { root, host } = await mount();
    const row = host.querySelector('.sidebar-host-chrome .sidebar-grid-row');
    const primary = host.querySelector('[data-testid="new-chat-button"]');
    const icon = row?.querySelector('[data-sidebar-grid="icon"]');
    const label = primary?.querySelector('[data-sidebar-grid="label"]');
    const trailing = row?.querySelector('[data-sidebar-grid="trailing"]');

    expect(row?.getAttribute("data-sidebar-row")).toBe("new-chat");
    expect(primary?.classList.contains("sidebar-new-chat-primary")).toBe(true);
    expect(icon).not.toBeNull();
    expect(primary?.contains(icon!)).toBe(true);
    expect(label?.textContent).toContain("New chat");
    expect(primary?.contains(trailing!)).toBe(false);
    expect(trailing?.querySelector('[data-sidebar-grid-action="penultimate"]')).not.toBeNull();
    expect(trailing?.querySelector('[data-sidebar-grid-action="last"]')).not.toBeNull();

    await act(async () => {
      if (primary instanceof HTMLButtonElement) primary.click();
    });
    await act(async () => root.unmount());
  });
});
