/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenmaAccountState, OpenmaTask } from "@shared/openma";
import type { ProjectInfo } from "@shared/projects";
import { sessionStore } from "@/lib/session-store";

const scope = {
  baseUrl: "https://openma.example",
  userId: "tenant-user",
  workspaceId: "tenant-1",
};
const signedOutAccount: OpenmaAccountState = {
  status: "signed_out",
  baseUrl: scope.baseUrl,
  user: null,
  workspaces: [],
  activeWorkspaceId: null,
};
let currentPath = "/";
let taskRefreshMode: "success" | "error" | "pending" = "success";
let taskRefreshCalls = 0;

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
        "sidebar.pinned": "Pinned",
        "sidebar.emptyTenant": "No tenant conversations",
        "sidebar.loadingTenant": "Loading tenant conversations",
        "sidebar.tenantLoadFailed": "Tenant conversations unavailable",
        "openma.signIn": "Sign in",
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
  useLocation: () => ({ pathname: currentPath }),
  useNavigate: () => () => undefined,
}));

import { Sidebar } from "./Sidebar";
import { SidebarCollapseContext } from "./AppShell";

function accountWithStatus(
  status: OpenmaAccountState["status"],
  workspaceId = scope.workspaceId,
): OpenmaAccountState {
  return {
    status,
    baseUrl: scope.baseUrl,
    user: { id: scope.userId, email: "tenant@example.com", name: "Tenant User" },
    workspaces: [{ id: workspaceId, name: "Demo", role: "member" }],
    activeWorkspaceId: workspaceId,
  };
}

function openmaTask(id: string, title: string, pinnedAt?: number): OpenmaTask {
  return {
    ...scope,
    id,
    sessionId: id,
    target: {
      ...scope,
      kind: "cloud",
      agentId: "agent-1",
      agentName: "Agent",
      environmentId: "environment-1",
      environmentName: "Environment",
      runtimeId: null,
      runtimeName: "Cloud",
    },
    title,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    afterSeq: 0,
    pinnedAt,
  };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installBackchat(
  account: OpenmaAccountState = signedOutAccount,
  projects: ProjectInfo[] = [],
  coordinatorAgent?: string,
): void {
  taskRefreshCalls = 0;
  const api = new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop.startsWith("on")) return () => () => undefined;
      if (prop === "openmaAccountState") return async () => account;
      if (prop === "projectsList") return async () => projects;
      if (prop === "projectWorkView") return async () => ({
        config: coordinatorAgent ? { coordinatorAgent } : null,
        facts: { sessions: [] },
      });
      if (prop === "agentsList") return async () => [];
      if (prop === "openmaTasksRefresh") return async () => {
        taskRefreshCalls += 1;
        if (taskRefreshMode === "error") throw new Error("tenant unavailable");
        if (taskRefreshMode === "pending") return new Promise<OpenmaTask[]>(() => {});
        return [];
      };
      if (prop === "openmaCatalog") {
        return async () => ({ runners: [], cloudAgents: [], environments: [] });
      }
      return async () => [];
    },
  });
  window.backchat = api as unknown as typeof window.backchat;
}

async function mount(collapsed = false): Promise<{ root: Root; host: HTMLDivElement }> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <SidebarCollapseContext.Provider value={{ collapsed, toggle: vi.fn(), set: vi.fn() }}>
        <QueryClientProvider client={client}>
          <Sidebar />
        </QueryClientProvider>
      </SidebarCollapseContext.Provider>,
    );
  });
  return { root, host };
}

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(host.textContent).toContain(text));
  });
}

/** Tenant sections start collapsed, and a collapsed body is not mounted. */
async function openTenant(host: HTMLElement, name = "Demo"): Promise<void> {
  await waitForText(host, name);
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!.click());
}

describe("new chat sidebar grid", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    currentPath = "/";
    taskRefreshMode = "success";
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
    expect(trailing?.querySelector('[data-sidebar-grid-action="penultimate"]')).toBeNull();
    expect(trailing?.querySelector('[data-sidebar-grid-action="last"]')).not.toBeNull();

    await act(async () => {
      if (primary instanceof HTMLButtonElement) primary.click();
    });
    await act(async () => root.unmount());
  });

  it("hides section actions when the sidebar is collapsed", async () => {
    const { root, host } = await mount(true);
    const action = host.querySelector('[data-sidebar-section-header-action="true"]');
    expect(action?.classList.contains("hidden")).toBe(true);
    await act(async () => root.unmount());
  });

  it("does not show a redundant header menu containing only create-section", async () => {
    const {root,host}=await mount();
    expect(host.querySelector('button[aria-label="Sidebar options"]')).toBeNull();
    expect(host.querySelector('[aria-label="Search"]')).not.toBeNull();
    await act(async()=>root.unmount());
  });

  it("keeps the local group fixed and collapses its content instead of opening a runtime menu", async () => {
    installBackchat(accountWithStatus("signed_in"));
    const {root,host}=await mount();
    await waitForText(host,"Demo");
    const toggle=host.querySelector<HTMLButtonElement>('[data-testid="sidebar-local-runtime-row"] button')!;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toContain("chat.local");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async()=>toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('.sidebar-local-content')?.getAttribute('data-state')).toBe('closed');
    await act(async()=>root.unmount());
  });

  it("renders tenant conversations and iconless rows on the shared grid", async () => {
    installBackchat(accountWithStatus("signed_in"));
    sessionStore.seedOpenmaTasks([
      openmaTask("tenant-pinned", "Pinned tenant conversation", 1),
      openmaTask("tenant-chat", "Tenant conversation"),
    ]);
    const { root, host } = await mount();
    await openTenant(host);

    const header = host.querySelector('button[aria-label="Demo"]');
    const headerRow = header?.closest<HTMLElement>(".sidebar-grid-row");
    expect(headerRow?.getAttribute("data-sidebar-leading")).toBe("none");
    expect(headerRow?.querySelector('[data-sidebar-grid="icon"]')).toBeNull();

    const tenantRows = [...host.querySelectorAll<HTMLElement>(
      '.sidebar-grid-row[data-sidebar-depth="0"]',
    )];
    expect(tenantRows.some((row) => row.textContent?.includes("New chat"))).toBe(true);
    expect(tenantRows.some((row) => row.textContent?.includes("Pinned"))).toBe(true);
    expect(tenantRows.some((row) => row.textContent?.includes("Pinned tenant conversation"))).toBe(true);
    expect(tenantRows.some((row) => row.textContent?.includes("Tenant conversation"))).toBe(true);
    await act(async () => root.unmount());
  });

  it.each([undefined, "codex-acp"])("opens the project through its name while disclosure only expands (%s)", async coordinatorAgent => {
    const project: ProjectInfo = { id: "coordinator-project", name: "Coordinator project", primary_folder: "/work/coordinator-project", source_folders: ["/work/coordinator-project"], created_at: 1, updated_at: 1 };
    installBackchat(signedOutAccount, [project], coordinatorAgent);
    const { root, host } = await mount();
    await act(async () => { await vi.waitFor(() => expect(host.querySelector('[data-sidebar-project="project:coordinator-project"]')).not.toBeNull()); });
    const row = host.querySelector('[data-sidebar-project="project:coordinator-project"]')!;
    const toggle = row.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.closest('[data-sidebar-grid="icon"]')).not.toBeNull();
    const label = row.querySelector<HTMLButtonElement>('[data-sidebar-grid="label"] button')!;
    expect(label.getAttribute("aria-expanded")).toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[data-testid="project-coordinator-row"]')).toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => label.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => root.unmount());
  });

  it("retains project selection on its coordinator route but not unrelated routes", async () => {
    const project: ProjectInfo = { id: "selected-project", name: "Selected project", primary_folder: "", source_folders: [], created_at: 1, updated_at: 1 };
    installBackchat(signedOutAccount, [project]);
    currentPath = "/projects/selected-project";
    const { root, host } = await mount();
    await act(async () => { await vi.waitFor(() => expect(host.querySelector('[data-sidebar-project="project:selected-project"]')).not.toBeNull()); });
    const row = host.querySelector('[data-sidebar-project="project:selected-project"]')!;
    expect(row.classList.contains("app-selected-surface")).toBe(true);
    expect(row.querySelector('[data-sidebar-grid="label"] button')?.getAttribute("aria-current")).toBe("page");
    expect(row.querySelector('button[aria-expanded]')?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => root.unmount());
    currentPath = "/chat/another-session";
    const other = await mount();
    await act(async () => { await vi.waitFor(() => expect(other.host.querySelector('[data-sidebar-project="project:selected-project"]')).not.toBeNull()); });
    expect(other.host.querySelector('[data-sidebar-project="project:selected-project"]')?.classList.contains("app-selected-surface")).toBe(false);
    await act(async () => other.root.unmount());
  });

  it("uses a label-only sign-in row for a workspace still signing in", async () => {
    installBackchat(accountWithStatus("signing_in", "tenant-signing"));
    const { root, host } = await mount();
    await openTenant(host);
    await waitForText(host, "Sign in");

    const signIn = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Sign in"));
    const row = signIn?.closest<HTMLElement>(".sidebar-grid-row");
    // Section labels carry no icon, so their rows align with the label.
    expect(row?.getAttribute("data-sidebar-depth")).toBe("0");
    expect(row?.getAttribute("data-sidebar-leading")).toBe("none");
    expect(row?.getAttribute("data-sidebar-trailing-track")).toBe("none");
    await act(async () => signIn?.click());
    await act(async () => root.unmount());
  });

  it("renders the tenant task retry row when loading fails", async () => {
    taskRefreshMode = "error";
    installBackchat(accountWithStatus("signed_in", "tenant-error"));
    const { root, host } = await mount();
    await openTenant(host);
    await waitForText(host, "Tenant conversations unavailable");

    const retryRow = [...host.querySelectorAll<HTMLElement>(".sidebar-grid-row")]
      .find((row) => row.textContent?.includes("Tenant conversations unavailable"));
    expect(retryRow?.getAttribute("data-sidebar-depth")).toBe("0");
    await act(async () => retryRow?.click());
    expect(taskRefreshCalls).toBeGreaterThanOrEqual(2);
    await act(async () => root.unmount());
  });

  it("shows the loading and empty tenant states from the task query", async () => {
    taskRefreshMode = "pending";
    installBackchat(accountWithStatus("signed_in", "tenant-pending"));
    const pending = await mount();
    await openTenant(pending.host);
    await waitForText(pending.host, "Loading tenant conversations");
    expect([...pending.host.querySelectorAll('[role="status"]')]
      .some((row) => row.textContent?.includes("Loading tenant conversations"))).toBe(true);
    await act(async () => pending.root.unmount());

    taskRefreshMode = "success";
    installBackchat(accountWithStatus("signed_in", "tenant-empty"));
    const empty = await mount();
    await openTenant(empty.host);
    await waitForText(empty.host, "No tenant conversations");
    expect([...empty.host.querySelectorAll('[role="status"]')]
      .some((row) => row.textContent?.includes("No tenant conversations"))).toBe(true);
    await act(async () => empty.root.unmount());
  });
});
