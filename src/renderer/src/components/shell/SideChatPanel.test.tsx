import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let rightRailExpanded = false;
let expandedMainSelected = false;
let leftSidebarCollapsed = false;
let sideTabs: Array<Record<string, unknown>> = [];
let activeSideTab: Record<string, unknown> | null = null;

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/chat/ChatView", () => ({
  ChatView: () => <div data-chat-view />,
}));
vi.mock("@/components/shell/FileTree", () => ({
  FileTree: () => <div data-file-tree />,
}));
vi.mock("@/components/shell/BrowserTab", () => ({
  BrowserTab: () => <div data-browser-tab />,
}));
vi.mock("@/components/shell/TerminalTab", () => ({
  TerminalTab: () => <div data-terminal-tab />,
}));
vi.mock("@/components/shell/BackgroundProcessTab", () => ({
  BackgroundProcessTab: () => <div data-process-tab />,
}));
vi.mock("@/components/shell/RightPanelLauncher", () => ({
  RightPanelLauncher: () => <div data-task-workspace />,
}));
vi.mock("@/components/shell/AppShell", () => ({
  useRightRailCollapse: () => ({ toggle: vi.fn() }),
  useSidebarCollapse: () => ({ collapsed: leftSidebarCollapsed }),
  useRightRailExpansion: () => ({
    expanded: rightRailExpanded,
    mainSelected: expandedMainSelected,
    setExpanded: vi.fn(),
    selectMain: vi.fn(),
    selectPanel: vi.fn(),
  }),
}));
vi.mock("@/lib/settings-store", () => ({
  useSettings: () => ({}),
}));
vi.mock("@shared/browser-settings.js", () => ({
  browserSettings: () => ({ enabled: true }),
}));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "rightPanel.newTab": "New tab",
      "sideChat.closePanel": "Close side panel",
      "sideChat.expandPanel": "Expand panel",
      "sideChat.restoreSplitView": "Restore split view",
      "sideChat.promote": "Promote to main chat",
    })[key] ?? key,
  }),
}));
vi.mock("@/lib/session-store", () => ({
  selectSideTabs: "sideTabs",
  selectActiveSideTab: "activeSideTab",
  selectBrowserWindows: "browserWindows",
  selectActive: "active",
  selectArtifactsFor: () => "artifacts",
  selectSubagentsFor: () => "subagents",
  selectWorkItemsFor: () => "workItems",
  selectTurnsFor: () => "turns",
  useSessionStore: (selector: string) => {
    if (selector === "sideTabs") return sideTabs;
    if (selector === "activeSideTab") return activeSideTab;
    if (selector === "browserWindows") return [];
    if (selector === "active") {
      return {
        id: "session-1",
        label: "Right panel source",
        status: "ready",
        cwd: "/tmp/project",
        agent_id: "codex",
      };
    }
    if (selector === "artifacts") return { files: [], services: [], sources: [] };
    if (selector === "subagents") return [];
    if (selector === "workItems") return [];
    if (selector === "turns") return [];
    return undefined;
  },
  sessionStore: {
    setActiveSideTab: vi.fn(),
    openSideTab: vi.fn(),
    openSideTabForTask: vi.fn(),
    patchSideTabForTask: vi.fn(),
  },
}));

import { SideChatPanel } from "./SideChatPanel";

describe("SideChatPanel new-tab workspace", () => {
  beforeEach(() => {
    rightRailExpanded = false;
    expandedMainSelected = false;
    leftSidebarCollapsed = false;
    sideTabs = [];
    activeSideTab = null;
  });

  it("shows New tab content without adding a tab when no resource tab is active", () => {
    const markup = renderToStaticMarkup(<SideChatPanel />);

    expect(markup).toContain('data-task-workspace="true"');
    expect(markup).not.toContain('data-new-tab-page="true"');
    expect(markup).not.toContain('id="new-tab-page-tab"');
    expect(markup).not.toContain('data-task-workspace-tab="true"');
  });

  it("offers to expand the side panel without showing a duplicate main-session tab", () => {
    const markup = renderToStaticMarkup(<SideChatPanel />);

    expect(markup).toContain('aria-label="Expand panel"');
    expect(markup).not.toContain('data-pinned-main-session="true"');
  });

  it("pins the main session before resource tabs while the panel is expanded", () => {
    rightRailExpanded = true;

    const markup = renderToStaticMarkup(<SideChatPanel />);

    expect(markup).toContain('data-pinned-main-session="true"');
    expect(markup).toContain("Right panel source");
    expect(markup).toContain('aria-label="Restore split view"');
    expect(markup).not.toContain('aria-label="Expand panel"');
  });

  it("keeps the close action in split view but removes it from expanded view", () => {
    expect(renderToStaticMarkup(<SideChatPanel />)).toContain(
      'aria-label="Close side panel"',
    );

    rightRailExpanded = true;

    expect(renderToStaticMarkup(<SideChatPanel />)).not.toContain(
      'aria-label="Close side panel"',
    );
  });

  it("keeps the expanded tab bar interactive while revealing the selected main session", () => {
    rightRailExpanded = true;
    expandedMainSelected = true;

    const markup = renderToStaticMarkup(<SideChatPanel />);

    expect(markup).toContain('data-expanded-main-selected="true"');
    expect(markup).toContain('data-panel-content-hidden="true"');
    expect(markup).toContain('data-pinned-main-session="true"');
    expect(markup).toContain('aria-selected="true"');
  });

  it("keeps the pinned main session left of resources and panel controls on the right", () => {
    rightRailExpanded = true;

    const markup = renderToStaticMarkup(<SideChatPanel />);
    const tabList = markup.indexOf('role="tablist"');
    const pinnedMain = markup.indexOf('data-pinned-main-session="true"');
    const resourceTabs = markup.indexOf('data-side-tab-scroll="true"');
    const restore = markup.indexOf('aria-label="Restore split view"');
    const close = markup.indexOf('aria-label="Close side panel"');

    expect(tabList).toBeLessThan(pinnedMain);
    expect(pinnedMain).toBeLessThan(resourceTabs);
    expect(resourceTabs).toBeLessThan(restore);
    expect(close).toBe(-1);
  });

  it("keeps expanded tabs clear of window chrome when the left sidebar is collapsed", () => {
    rightRailExpanded = true;
    leftSidebarCollapsed = true;

    const markup = renderToStaticMarkup(<SideChatPanel />);

    expect(markup).toContain('data-header-clears-left-chrome="true"');
    expect(markup).toContain(
      "padding-left:calc(var(--left-chrome-end) + var(--chrome-title-gap) - var(--stage-inset))",
    );
  });

  it("keeps every expanded action button outside the native window drag region", () => {
    rightRailExpanded = true;
    expandedMainSelected = true;

    const markup = renderToStaticMarkup(<SideChatPanel />);

    for (const label of ["New tab", "Restore split view"]) {
      expect(markup).toMatch(
        new RegExp(`aria-label="${label}"[^>]*class="[^"]*app-no-drag`),
      );
    }
  });

  it("keeps the active side-chat promote action outside the native drag region", () => {
    rightRailExpanded = true;
    activeSideTab = {
      id: "side-chat-1",
      type: "chat",
      payload: "side-session-1",
      label: "Context fork",
    };
    sideTabs = [activeSideTab];

    const markup = renderToStaticMarkup(<SideChatPanel />);

    expect(markup).toMatch(
      /aria-label="Promote to main chat"[^>]*class="[^"]*app-no-drag/,
    );
  });

  it("shows a browser favicon instead of the generic browser glyph", () => {
    activeSideTab = {
      id: "browser-1",
      type: "browser",
      payload: "https://example.test/",
      label: "Example",
      faviconUrl: "data:image/png;base64,example-icon",
    };
    sideTabs = [activeSideTab];

    const markup = renderToStaticMarkup(<SideChatPanel />);

    expect(markup).toContain(
      'src="data:image/png;base64,example-icon"',
    );
    expect(markup).not.toContain("lucide-globe");
  });
});
