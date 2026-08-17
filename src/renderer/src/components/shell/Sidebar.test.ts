/// <reference types="node" />

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

import { groupSidebarSessions } from "./Sidebar";
import type { SessionRow } from "@/lib/session-store";

function row(overrides: Partial<SessionRow>): SessionRow {
  return {
    id: overrides.id ?? "sess-1",
    agent_id: "codex-acp",
    cwd: overrides.cwd ?? "",
    acp_session_id: "",
    label: overrides.label ?? overrides.id ?? "Chat",
    status: "ready",
    createdAt: 1,
    ...overrides,
  };
}

describe("groupSidebarSessions", () => {
  it("keeps an explicitly global chat out of projects even when cwd is stale", () => {
    const global = row({
      id: "global-chat",
      cwd: "/work/project-a",
      projectScope: "none",
    });

    expect(groupSidebarSessions([global])).toMatchObject({
      projects: [],
      chats: [global],
    });
  });

  it("creates global and project drafts with explicit, separate scopes", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");

    expect(source).toContain("sessionStore.newDraft();");
    expect(source).toContain("sessionStore.newDraft(cwd);");
    expect(source).toContain('navigate({ to: "/" })');
  });

  it("does not persist a selected style on project folders", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const projectRow = source.slice(
      source.indexOf("function ProjectSidebarRow"),
      source.indexOf("function PairSidebarRow"),
    );

    expect(projectRow).not.toContain("active: boolean");
    expect(projectRow).not.toContain("app-selected-surface");
  });

  it("uses closed and open folder icons for project disclosure state", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const projectRow = source.slice(
      source.indexOf("function ProjectSidebarRow"),
      source.indexOf("function PairSidebarRow"),
    );

    expect(projectRow).toContain("open ? FolderOpenIcon : FolderIcon");
    expect(projectRow).toContain("<ProjectIcon");
  });

  it("keeps project disclosure on the folder icon instead of a trailing chevron", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const projectRow = source.slice(
      source.indexOf("function ProjectSidebarRow"),
      source.indexOf("function PairSidebarRow"),
    );

    expect(projectRow).not.toContain("ChevronRightIcon");
  });

  it("reveals project actions on hover without making the folder selected", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const projectRow = source.slice(
      source.indexOf("function ProjectSidebarRow"),
      source.indexOf("function PairSidebarRow"),
    );

    expect(projectRow).toContain('t("sidebar.projectActions")');
    expect(projectRow).toContain('t("sidebar.startProjectChat")');
    expect(projectRow).toContain("group-hover:opacity-100");
    expect(projectRow).toContain("<DropdownMenu");
    expect(projectRow).toContain(
      'className={cn(\n          labelCls,\n          "ml-auto inline-flex shrink-0',
    );
  });

  it("keeps project folders stateless and leaves activity on child sessions", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const projectRow = source.slice(
      source.indexOf("function ProjectSidebarRow"),
      source.indexOf("function PairSidebarRow"),
    );

    expect(projectRow).not.toContain("session.status");
    expect(projectRow).not.toContain("session.unread");
    expect(projectRow).not.toContain("Loader2Icon");
    expect(projectRow).not.toContain("animate-spin");
  });

  it("uses the shared tokenized collapse for project children", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const collapse = readFileSync(
      resolve(__dirname, "../ui/animated-collapse.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );

    expect(source).toContain("<AnimatedCollapse open={open}>");
    expect(collapse).toContain('data-slot="animated-collapse"');
    expect(styles).toContain("--motion-disclosure-duration");
    expect(styles).toContain("--motion-disclosure-easing");
    expect(styles).toContain(".animated-collapse");
  });

  it("makes every populated sidebar section independently collapsible", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");

    expect(source).toContain("function SidebarSection");
    expect(source).toContain('toggleSection("pinned")');
    expect(source).toContain('toggleSection("pairs")');
    expect(source).toContain('toggleSection("projects")');
    expect(source).toContain('toggleSection("chats")');
    expect(source).toContain("<AnimatedCollapse open={open}>");
    expect(
      source.slice(
        source.indexOf("function SidebarSection"),
        source.indexOf("function ProjectSidebarRow"),
      ),
    ).not.toContain("uppercase");
  });

  it("keeps each section chevron directly beside its title", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const section = source.slice(
      source.indexOf("function SidebarSection"),
      source.indexOf("function ProjectSidebarRow"),
    );

    expect(section).toContain('cn("min-w-0 truncate", labelCls)');
    expect(section).not.toContain('cn("min-w-0 flex-1 truncate", labelCls)');
    expect(section).toContain('open && "rotate-90"');
  });

  it("presents pair chat as a multi-Agent workflow with matching icons", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const launcher = source.slice(source.indexOf("function PairChatLauncher"));

    expect(source).toContain("UsersRoundIcon");
    expect(source).not.toContain("LayoutGridIcon");
    expect(launcher).toContain("CheckIcon");
  });

  it("exposes rename actions for sessions and pair chats", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const sessionRow = source.slice(
      source.indexOf("function SessionRow"),
      source.indexOf("function PairChatLauncher"),
    );
    const pairRow = source.slice(
      source.indexOf("function PairSidebarRow"),
      source.indexOf("function SessionRow"),
    );

    expect(sessionRow).toContain('t("sidebar.rename")');
    expect(pairRow).toContain('t("sidebar.rename")');
    expect(pairRow).toContain("<DropdownMenu");
  });

  it("confirms archive when the chat still has a live scheduled task", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");

    expect(source).toContain("requestArchive(");
    expect(source).toContain("<ArchiveScheduledChatDialog");
    expect(source).not.toContain("sessionStore.archive(row.id)");
    expect(source).not.toContain("sessionStore.archive(session.id)");
  });

  it("shows a display-only schedule clock in the session row action slot", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const sessionRow = source.slice(
      source.indexOf("function SessionRow"),
      source.indexOf("function PairChatLauncher"),
    );

    expect(sessionRow).toContain('data-sidebar-schedule-indicator="true"');
    expect(sessionRow).toContain("pointer-events-none");
    expect(sessionRow).toContain("CalendarClockIcon");
    expect(sessionRow).toContain("opacity-0 group-hover:opacity-100");
  });

  it("links the multi-Agent picker to Agent settings with the settings icon", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const launcher = source.slice(source.indexOf("function PairChatLauncher"));

    expect(launcher).toContain('navigate({ to: "/settings/agents" })');
    expect(launcher).toContain("CpuIcon");
    expect(launcher).toContain('t("sidebar.manageAgents")');
  });

  it("centers the settings row inside symmetric footer padding", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const footer = source.slice(source.indexOf("{/* Footer navigation and update affordance"));

    expect(footer).toContain('className="py-[var(--bottom-bar-gap-y)]"');
    expect(styles).toContain("--bottom-bar-gap-y: 6px;");
    expect(styles).toContain(
      "--composer-footer-gap: calc(var(--bottom-bar-gap-y) - 1px);",
    );
  });

  it("keeps Settings and ACP updates as independent footer controls", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const updateControl = readFileSync(
      resolve(__dirname, "AgentUpdateControl.tsx"),
      "utf8",
    );
    const footer = source.slice(source.indexOf("{/* Footer navigation and update affordance"));

    expect(footer).toContain('to="/settings"');
    expect(footer).toContain("<AgentUpdateControl agents={agents} />");
    expect(footer).toContain(
      'className="flex w-full items-stretch overflow-hidden rounded-md"',
    );
    expect(footer.indexOf("<AgentUpdateControl")).toBeGreaterThan(
      footer.indexOf("</Link>"),
    );
    expect(updateControl).not.toContain("border-l");
  });

  it("presents ACP updates as a quiet anchored popover instead of a modal", () => {
    const source = readFileSync(
      resolve(__dirname, "AgentUpdateControl.tsx"),
      "utf8",
    );

    expect(source).toContain('from "@/components/ui/popover"');
    expect(source).toContain('data-sidebar-agent-update-popover="true"');
    expect(source).toContain('side="top"');
    expect(source).toContain('align="start"');
    expect(source).toContain("<PopoverHeader>");
    expect(source).toContain("<PopoverTitle");
    expect(source).toContain("<PopoverDescription");
    expect(source).toContain('<Badge variant="secondary"');
    expect(source).toContain("<AgentIcon");
    expect(source).toContain('variant="outline"');
    expect(source).toContain('data-agent-update-spinner="true"');
    expect(source).not.toContain('role="progressbar"');
    expect(source).not.toContain('loading={updating}');
    expect(source).not.toContain('variant="ghost"');
    expect(source).not.toContain("w-[340px]");
    expect(source).not.toContain("bg-warning-subtle");
    expect(source).not.toContain("<Dialog");
    expect(source).not.toContain("border-b");
    expect(source).not.toContain("border-t");
  });

  it("shares one canonical Agent cache between the sidebar, updater, and Settings", () => {
    const sidebar = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const updater = readFileSync(resolve(__dirname, "AgentUpdateControl.tsx"), "utf8");
    const settings = readFileSync(
      resolve(__dirname, "../../pages/settings/Agents.tsx"),
      "utf8",
    );

    for (const source of [sidebar, updater, settings]) {
      expect(source).toContain("AGENTS_QUERY_KEY");
      expect(source).not.toContain('["agents", "setup"]');
    }
  });

  it("keeps Scheduled with the header actions instead of the settings footer", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const scheduled = source.indexOf('to="/scheduled"');
    const conversationNav = source.indexOf("<nav", scheduled);
    const footer = source.indexOf("{/* Footer navigation and update affordance");

    expect(scheduled).toBeGreaterThan(source.indexOf('data-testid="new-chat-button"'));
    expect(scheduled).toBeLessThan(conversationNav);
    expect(source.slice(footer)).not.toContain('to="/scheduled"');
  });

  it("places the settings icon on the same horizontal track as session icons", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const footer = source.slice(source.indexOf("{/* Footer navigation and update affordance"));

    expect(footer).toContain(
      '<span className="sidebar-row-icon">',
    );
    expect(footer).toContain(
      '<Settings2Icon className="size-3.5" />',
    );
  });

  it("keeps every row icon on one shared 16px rail", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );

    expect(styles).toContain(".sidebar-row-icon {");
    for (const component of [
      "function ProjectSidebarRow",
      "function PairSidebarRow",
      "function SessionRow",
    ]) {
      const start = source.indexOf(component);
      expect(source.slice(start, start + 2400)).toContain("sidebar-row-icon");
    }
    // No row renders a bare glyph outside the shared box.
    expect(source).not.toContain('className="size-3.5 shrink-0');
    expect(source).not.toContain('"inline-flex size-4 shrink-0');
  });

  it("puts the running spinner in the same reserved trailing slot as the schedule clock", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const sessionRow = source.slice(
      source.indexOf("function SessionRow"),
      source.indexOf("function PairChatLauncher"),
    );
    const trailing = sessionRow.slice(sessionRow.indexOf("sidebar-row-trailing"));

    expect(styles).toContain(".sidebar-row-trailing {");
    expect(styles).toContain("width: var(--sidebar-row-action-size);");
    expect(sessionRow).toContain("sidebar-row-trailing");
    expect(trailing.split("sidebar-row-trailing").length - 1).toBe(1);
    expect(trailing).toContain("{running ?");
    expect(trailing.indexOf("Loader2Icon")).toBeGreaterThan(trailing.indexOf("sidebar-row-trailing"));
    expect(trailing.indexOf("data-sidebar-schedule-indicator")).toBeGreaterThan(
      trailing.indexOf("Loader2Icon"),
    );
  });

  it("renders a dedicated Pinned section before every other conversation section", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");

    const pinnedSection = source.indexOf("{pinned.length > 0 && (");
    const pairSection = source.indexOf("{pairs.length > 0 && (");
    const projectSection = source.indexOf("{projects.length > 0 && (");
    const chatSection = source.indexOf("{chats.length > 0 && (");

    expect(pinnedSection).toBeGreaterThan(-1);
    expect(source.slice(pinnedSection, pairSection)).toContain('t("sidebar.pinned")');
    expect(pinnedSection).toBeLessThan(pairSection);
    expect(pinnedSection).toBeLessThan(projectSection);
    expect(pinnedSection).toBeLessThan(chatSection);
  });

  it("groups unpinned project sessions by cwd", () => {
    const grouped = groupSidebarSessions([
      row({ id: "a", cwd: "/Users/minimax/oos-proj/openma" }),
      row({ id: "b", cwd: "/Users/minimax/oos-proj/openma" }),
      row({ id: "c", cwd: "/Users/minimax/oos-proj/trade-desk" }),
    ]);

    expect(grouped.projects.map((project) => ({
      label: project.label,
      ids: project.sessions.map((session) => session.id),
    }))).toEqual([
      { label: "openma", ids: ["a", "b"] },
      { label: "trade-desk", ids: ["c"] },
    ]);
    expect(grouped.chats).toEqual([]);
  });

  it("keeps pinned and app-managed session folders out of project groups", () => {
    const pinned = row({
      id: "pinned",
      cwd: "/Users/minimax/oos-proj/openma",
      pinnedAt: 123,
    });
    const appManaged = row({
      id: "managed",
      cwd: "/Users/minimax/.oma/sessions/sess-rfwr779u",
    });
    const noCwd = row({ id: "plain", cwd: "" });

    const grouped = groupSidebarSessions([pinned, appManaged, noCwd]);

    expect(grouped.pinned.map((session) => session.id)).toEqual(["pinned"]);
    expect(grouped.projects).toEqual([]);
    expect(grouped.chats.map((session) => session.id)).toEqual([
      "managed",
      "plain",
    ]);
  });
});
