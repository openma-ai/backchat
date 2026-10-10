/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInfo } from "@shared/api";
import type { Settings } from "@shared/settings";

const harness = vi.hoisted(() => ({
  pathname: "/settings/activity",
  projects: [] as Array<{
    id: string;
    name: string;
    source_folders: string[];
    primary_folder: string;
  }>,
  query: {
    isLoading: false,
    isFetching: false,
    data: undefined as unknown,
    error: null as unknown,
    refetch: () => Promise.resolve(undefined),
  },
  settings: null as Settings | null,
  archived: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    className,
    children,
  }: {
    to: string;
    className?: string;
    children?: ReactNode;
  }) => <a href={to} className={className}>{children}</a>,
  Outlet: () => <div data-outlet="true" />,
  useLocation: () => ({ pathname: harness.pathname }),
  useNavigate: () => () => undefined,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => harness.query,
  useQueries: () => [],
  useMutation: () => ({ mutate: () => undefined, error: null, isPending: false }),
  useQueryClient: () => ({
    invalidateQueries: () => undefined,
    setQueryData: () => undefined,
  }),
}));

vi.mock("@/lib/projects-query", () => ({
  useProjects: () => ({ data: harness.projects }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    locale: "en" as const,
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => harness.settings,
  getSettings: () => harness.settings,
  patchSettings: async () => undefined,
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ effective: "light" as const }),
}));

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

vi.mock("@/lib/openma-account", () => ({
  useOpenmaAccount: () => ({ data: undefined }),
  useOpenmaRunner: () => ({ data: undefined }),
}));

import { ComposerNotice } from "@/components/chat/ComposerNotice";
import { ComposerSurface } from "@/components/chat/ComposerPrimitives";
import { ContentPage, PageScaffold } from "@/components/shell/PageScaffold";
import { SessionRow } from "@/components/shell/Sidebar";
import { sessionStore } from "@/lib/session-store";
import { SettingsAbout } from "@/pages/settings/About";
import { SettingsAgents } from "@/pages/settings/Agents";
import { SettingsActivity } from "@/pages/settings/Activity";
import {
  AgentAuthSetupPanel,
  CustomAgentPanel,
} from "@/pages/settings/AgentSettingsPanels";
import { SettingsAppearance } from "@/pages/settings/Appearance";
import { Archive } from "@/pages/settings/Archive";
import { SettingsBrowserPage } from "@/pages/settings/Browser";
import { SettingsMcpServers } from "@/pages/settings/McpServers";
import { SettingsLayout, SettingsSidebar } from "@/pages/settings/SettingsLayout";
import {
  SettingsCard,
  SettingsField,
  SettingsListRow,
  SettingsSection,
} from "@/pages/settings/SettingsPrimitives";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installBackchatStub() {
  const api = new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return () => prop.startsWith("on") ? () => undefined : Promise.resolve(undefined);
    },
  });
  window.backchat = api as unknown as typeof window.backchat;
}

const settingsFixture: Settings = {
  default: {
    workspace_path: "",
    permission_mode: "ask",
    prompt_queue_enabled: true,
  },
  appearance: {
    light_theme_id: "backchat-light",
    dark_theme_id: "backchat-dark",
    theme: "system",
    language: "en",
    font_size: "md",
    density: "default",
  },
  agents: [],
  mcp_servers: [],
};

function sessionRow(status: "ready" | "errored" | "running" = "ready") {
  return {
    id: "sess-1",
    agent_id: "codex-acp",
    cwd: "",
    acp_session_id: "",
    label: status === "errored" ? "Broken chat" : "Backchat",
    status,
    createdAt: 1,
    lastError: status === "errored" ? "failed" : undefined,
  };
}

async function mount(node: ReactNode): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return { host, root };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  harness.pathname = "/settings/activity";
  harness.projects = [];
  harness.query = {
    isLoading: false,
    isFetching: false,
    data: undefined,
    error: null,
    refetch: () => Promise.resolve(undefined),
  };
  harness.settings = settingsFixture;
  harness.archived = [];
  installBackchatStub();
  vi.spyOn(sessionStore, "listArchivedPersisted").mockResolvedValue([]);
  vi.spyOn(sessionStore, "seedOpenmaTasks").mockImplementation(() => undefined);
  document.body.innerHTML = "";
});

describe("settings surfaces render the shared box and row", () => {
  it("renders composer, page scaffold, and settings primitives", async () => {
    const composer = await mount(
      <>
        <ComposerSurface>Hello</ComposerSurface>
        <ComposerSurface className="extra">More</ComposerSurface>
        <ComposerNotice
          notice={{ id: "notice-1", tone: "warning", message: "Heads up", expiresAt: 10_000 }}
          dismissLabel="Dismiss"
          onDismiss={() => undefined}
        />
        <ContentPage><PageScaffold title="Title">Body</PageScaffold></ContentPage>
        <PageScaffold title="T" description="D" meta="M" actions={<button type="button">A</button>}>
          Child
        </PageScaffold>
        <SettingsSection title="Section" description="About this">
          <SettingsCard>
            <SettingsField label="Name" hint="Hint"><input /></SettingsField>
          </SettingsCard>
        </SettingsSection>
        <SettingsSection title="Plain"><SettingsCard className="extra-card">Only</SettingsCard></SettingsSection>
        <SettingsListRow title="Row" description="Desc" actions={<button type="button">Go</button>} />
        <SettingsListRow title="Bare" />
      </>,
    );
    const html = composer.host.innerHTML;
    expect(html).toContain("app-composer-surface");
    expect(html).toContain("composer-radius");
    expect(html).toContain("pt-[var(--row-gap-y)]");
    await act(async () => composer.root.unmount());
  });

  it("renders settings navigation in the session row class", async () => {
    harness.projects = [
      { id: "p1", name: "bad", source_folders: ["/bad"], primary_folder: "/bad" },
      { id: "p2", name: "hidden", source_folders: ["/h"], primary_folder: "/h" },
    ];
    harness.pathname = "/settings/projects/p1";
    const view = await mount(<SettingsSidebar />);
    const rows = [...view.host.querySelectorAll("a.sidebar-nav-row")];
    expect(rows.length).toBeGreaterThan(1);
    expect(view.host.querySelector(".sidebar-navigation")).not.toBeNull();
    expect(view.host.querySelector('a[href="/settings/activity"]')?.className).toContain(
      "text-fg-muted",
    );
    expect(view.host.querySelector('a[href="/settings/projects/$projectId"]')?.className).toContain(
      "app-selected-surface",
    );
    const back = view.host.querySelector("button.sidebar-nav-row");
    expect(back?.className).toContain("w-fit");
    expect(back?.className).not.toContain("w-full");
    await act(async () => view.root.unmount());

    harness.pathname = "/settings/openma";
    harness.projects = [];
    const idle = await mount(<SettingsLayout />);
    expect(idle.host.querySelector("[data-outlet='true']")).not.toBeNull();
    expect(idle.host.querySelector("[data-settings-loading]")).toBeNull();
    harness.pathname = "/settings/browser";
    await act(async () => {
      idle.root.render(<SettingsLayout />);
    });
    expect(idle.host.querySelector("[data-settings-loading]")).toBeNull();
    expect(idle.host.querySelector("[data-outlet='true']")).not.toBeNull();
    await act(async () => idle.root.unmount());
  });

  it("renders a session row with the same class", async () => {
    for (const status of ["ready", "errored", "running"] as const) {
      const view = await mount(
        <SessionRow
          row={sessionRow(status) as never}
          active={status === "running"}
          labelCls="truncate"
          onSelect={() => undefined}
          onRename={() => undefined}
          onArchive={() => undefined}
          menuOpen={false}
          onMenuOpenChange={() => undefined}
        />,
      );
      expect(view.host.querySelector(".sidebar-nav-row")).not.toBeNull();
      await act(async () => view.root.unmount());
    }
  });

  it("renders activity, archive, about, browser, mcp, and appearance panels", async () => {
    harness.query = { ...harness.query, isLoading: true };
    const loading = await mount(<SettingsActivity />);
    expect(loading.host.innerHTML).toContain("app-composer-surface");
    await act(async () => loading.root.unmount());

    harness.query = {
      ...harness.query,
      isLoading: false,
      data: undefined,
      error: new Error("nope"),
    };
    const failed = await mount(<SettingsActivity />);
    expect(failed.host.innerHTML).toContain("app-composer-surface");
    await act(async () => failed.root.unmount());

    harness.query = {
      ...harness.query,
      isLoading: false,
      error: null,
      data: {
        summary: {
          total_tasks: 1,
          total_runs: 1,
          total_turns: 2,
          total_tool_calls: 3,
          total_harnesses: 1,
          active_days: 1,
          current_streak_days: 1,
          longest_streak_days: 1,
        },
        daily: [{ date: "2026-10-01", tasks: 1, turns: 2, tool_calls: 3 }],
        harnesses: [{
          harness_id: "codex-acp",
          harness_label: "Codex",
          tasks: 1,
          runs: 1,
          turns: 2,
          tool_calls: 3,
          active_days: 1,
          last_active_at: Date.UTC(2026, 9, 1),
        }],
      },
    };
    const activity = await mount(<SettingsActivity />);
    expect(activity.host.querySelector("section.app-composer-surface")).not.toBeNull();
    await act(async () => activity.root.unmount());

    vi.mocked(sessionStore.listArchivedPersisted).mockResolvedValueOnce([]);
    const emptyArchive = await mount(<Archive />);
    await settle();
    expect(emptyArchive.host.innerHTML).toContain("app-composer-surface");
    await act(async () => emptyArchive.root.unmount());

    vi.mocked(sessionStore.listArchivedPersisted).mockResolvedValueOnce([{
      id: "archived-1",
      agent_id: "codex-acp",
      cwd: "",
      acp_session_id: "",
      title: "Old chat",
      title_manually_set: 1,
      last_used_at: 1,
      created_at: 1,
      archived_at: 2,
      pinned_at: null,
      project_id: null,
      additional_directories: [],
      workspace_id: null,
      parent_session_id: null,
      fork_kind: null,
    }]);
    const archive = await mount(<Archive />);
    await settle();
    expect(archive.host.querySelector("ul.app-composer-surface")).not.toBeNull();
    await act(async () => archive.root.unmount());

    const about = await mount(<SettingsAbout />);
    expect(about.host.querySelector("dl.app-composer-surface")).not.toBeNull();
    await act(async () => about.root.unmount());

    harness.query = { ...harness.query, isLoading: false, data: [], error: null };
    const browser = await mount(<SettingsBrowserPage />);
    expect(browser.host.querySelectorAll(".app-composer-surface").length).toBeGreaterThan(1);
    await act(async () => browser.root.unmount());

    harness.settings = { ...settingsFixture, mcp_servers: [] };
    const mcpEmpty = await mount(<SettingsMcpServers />);
    expect(mcpEmpty.host.innerHTML).toContain("No MCP servers");
    const add = [...mcpEmpty.host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add server"));
    await act(async () => {
      add?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mcpEmpty.host.querySelector("form.app-composer-surface")).not.toBeNull();
    await act(async () => mcpEmpty.root.unmount());

    harness.settings = {
      ...settingsFixture,
      mcp_servers: [{
        id: "srv",
        type: "stdio",
        name: "local",
        command: "echo",
        args: [],
        env: [],
      }],
    };
    const mcp = await mount(<SettingsMcpServers />);
    expect(mcp.host.querySelector("ul.app-composer-surface")).not.toBeNull();
    await act(async () => mcp.root.unmount());

    const appearance = await mount(<SettingsAppearance />);
    expect(appearance.host.querySelectorAll(".app-composer-surface").length).toBeGreaterThan(0);
    expect(appearance.host.querySelector('[data-selected="true"]')).not.toBeNull();
    expect(appearance.host.querySelector(".composer-box-border:not([data-selected])")).not.toBeNull();
    await act(async () => appearance.root.unmount());
  });

  it("renders agent setup panels with and without an extra class", async () => {
    const agent = { id: "codex", label: "Codex", auth: { methods: [] } } as unknown as AgentInfo;
    const props = {
      agent,
      settings: settingsFixture,
      waitingForAuth: false,
      pending: false,
      onMethodIdChange: () => undefined,
      onStart: () => undefined,
      onClose: () => undefined,
      onSaved: () => undefined,
    };
    const plain = await mount(<AgentAuthSetupPanel {...props} />);
    expect(plain.host.innerHTML).toContain("ml-9");
    await act(async () => plain.root.unmount());
    const custom = await mount(<AgentAuthSetupPanel {...props} className="ml-0" />);
    expect(custom.host.innerHTML).toContain("ml-0");
    await act(async () => custom.root.unmount());
    const form = await mount(
      <CustomAgentPanel
        value={{ id: "", label: "", command: "", argsText: "", envText: "" }}
        onChange={() => undefined}
        onCancel={() => undefined}
        onSave={() => undefined}
      />,
    );
    expect(form.host.querySelector(".app-composer-surface")).not.toBeNull();
    await act(async () => form.root.unmount());
  });

  it("renders agent catalog cards for empty, listed, and custom rows", async () => {
    const empty = await mount(<SettingsAgents />);
    await settle();
    expect(empty.host.querySelectorAll(".app-composer-surface").length).toBeGreaterThan(1);
    await act(async () => empty.root.unmount());

    harness.query = {
      ...harness.query,
      data: [
        {
          id: "codex",
          label: "Codex",
          command: "codex",
          detected: true,
          available: true,
          installed: true,
          installable: false,
        },
        {
          id: "missing",
          label: "Missing",
          command: "missing",
          detected: false,
          available: false,
          installed: false,
          installable: true,
        },
      ],
    };
    harness.settings = {
      ...settingsFixture,
      agents: [{
        id: "local-agent",
        enabled: true,
        label_override: "Local",
        command_override: "echo",
        args_override: ["--acp"],
        env: [{ name: "TOKEN", value: "secret" }],
      }],
    };
    const listed = await mount(<SettingsAgents />);
    await settle();
    expect(listed.host.querySelectorAll("ul.app-composer-surface").length).toBe(3);
    const search = listed.host.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      search.value = "codex";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(listed.host.textContent).toContain("Codex");
    await act(async () => listed.root.unmount());
  });
});
