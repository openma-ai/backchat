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

    expect(source).toContain("const id = sessionStore.newDraft();");
    expect(source).toContain("const id = sessionStore.newDraft(cwd);");
    expect(source).toContain('to: "/chat/$sessionId"');
  });

  it("does not persist a selected style on project folders", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const projectRow = source.slice(
      source.indexOf("function ProjectSidebarRow"),
      source.indexOf("function PairSidebarRow"),
    );

    expect(projectRow).not.toContain("active: boolean");
    expect(projectRow).not.toContain("liquid-glass-selected");
    expect(projectRow).toContain("hover:bg-bg-surface/60");
    expect(projectRow).toContain("active:bg-bg-surface/80");
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

  it("links the multi-Agent picker to Agent settings with the settings icon", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const launcher = source.slice(source.indexOf("function PairChatLauncher"));

    expect(launcher).toContain('navigate({ to: "/settings/agents" })');
    expect(launcher).toContain("CpuIcon");
    expect(launcher).toContain('t("sidebar.manageAgents")');
  });

  it("centers the settings row inside symmetric footer padding", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const footer = source.slice(source.indexOf("{/* Footer — Settings link only."));

    expect(footer).toContain('className="py-[var(--row-gap-y)]"');
    expect(footer).not.toContain('className="pb-[var(--row-gap-y)]"');
  });

  it("places the settings icon on the same horizontal track as session icons", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const footer = source.slice(source.indexOf("{/* Footer — Settings link only."));

    expect(footer).toContain(
      '<Settings2Icon className="size-3.5 shrink-0" />',
    );
    expect(footer).not.toContain(
      '<span className="inline-flex size-4 shrink-0 items-center justify-center">',
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
      cwd: "/Users/minimax/.openma/sessions/sess-rfwr779u",
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
