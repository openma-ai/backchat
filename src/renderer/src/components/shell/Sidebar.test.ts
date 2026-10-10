/// <reference types="node" />

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

import { groupSidebarSessions } from "./Sidebar";
import type { SessionRow } from "@/lib/session-store";
import type { ProjectInfo } from "@shared/projects";
import type { WorkspaceInfo } from "@shared/workspaces";

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

function savedProject(id: string, root: string): ProjectInfo {
  return {
    id,
    name: root.split("/").at(-1)!,
    primary_folder: root,
    source_folders: [root],
    created_at: 1,
    updated_at: 1,
  };
}

function legacyWorkspace(root: string, projectId: string | null = null): WorkspaceInfo {
  return {
    id: "ws-fix",
    project_id: projectId,
    name: "fix-abc",
    kind: "managed",
    branch: "fix-abc",
    roots: [
      { sourcePath: `${root}/api`, effectivePath: "/wt/fix/01-api", worktreeIndex: 0 },
      { sourcePath: `${root}/web`, effectivePath: "/wt/fix/02-web", worktreeIndex: 1 },
    ],
    worktrees: [
      { repoRoot: `${root}/api`, path: "/wt/fix/01-api", head: "abc123", branch: "fix-abc" },
      { repoRoot: `${root}/web`, path: "/wt/fix/02-web", head: "def456", branch: "fix-abc" },
    ],
    created_by_session_id: null,
    created_at: 1,
    updated_at: 1,
  };
}

describe("legacy project promotion", () => {
  it("retains one project with its complete workspace and chats after saving its source folder", () => {
    const source = row({ id: "source", cwd: "/work/hilo-agent-opencode" });
    const child = row({ id: "child", cwd: "/wt/fix/01-api", workspaceId: "ws-fix" });
    const workspace = legacyWorkspace("/work/hilo-agent-opencode");
    const before = groupSidebarSessions([child, source], [], [workspace]);
    expect(before.projects).toHaveLength(1);

    const after = groupSidebarSessions(
      [child, source],
      [savedProject("saved-hilo", "/work/hilo-agent-opencode")],
      [workspace],
    );

    expect(after.projects).toHaveLength(1);
    expect(after.projects[0]).toMatchObject({
      projectId: "saved-hilo",
      label: "hilo-agent-opencode",
      primaryRoot: "/work/hilo-agent-opencode",
      sourceFolders: ["/work/hilo-agent-opencode"],
    });
    expect(after.projects[0].sessions.map(session => session.id)).toEqual(["source"]);
    expect(after.projects[0].workspaces).toHaveLength(1);
    expect(after.projects[0].workspaces[0]).toMatchObject({
      id: "ws-fix",
      label: "fix-abc",
      branch: "fix-abc",
      paths: ["/wt/fix/01-api", "/wt/fix/02-web"],
      info: workspace,
    });
    expect(after.projects[0].workspaces[0].sessions.map(session => session.id)).toEqual(["child"]);
    expect(after.chats).toEqual([]);
  });

  it.each([
    { explicitOwner: null, expectedOwner: "hilo", description: "closest source-root owner" },
    { explicitOwner: "all-work", expectedOwner: "all-work", description: "explicit workspace owner" },
  ])("keeps a legacy workspace under its $description", ({ explicitOwner, expectedOwner }) => {
    const child = row({ id: "child", cwd: "/wt/fix/01-api", workspaceId: "ws-fix" });
    const projects = [
      savedProject("all-work", "/work"),
      savedProject("hilo", "/work/hilo"),
      savedProject("api-only", "/work/hilo/api"),
    ];
    const workspace = legacyWorkspace("/work/hilo", explicitOwner);

    const result = groupSidebarSessions([child], projects, [workspace]);

    expect(result.projects).toHaveLength(3);
    const owners = result.projects.filter(project => project.workspaces.length > 0);
    expect(owners.map(project => project.projectId)).toEqual([expectedOwner]);
    expect(owners[0].workspaces).toHaveLength(1);
    expect(owners[0].workspaces[0].info).toEqual(workspace);
    expect(owners[0].workspaces[0].sessions.map(session => session.id)).toEqual(["child"]);
    expect(result.chats).toEqual([]);
  });

  it("does not merge unrelated projects that share a folder name", () => {
    const sourceA = row({ id: "source-a", cwd: "/company-a/hilo" });
    const sourceB = row({ id: "source-b", cwd: "/company-b/hilo" });
    const child = row({ id: "child-b", cwd: "/wt/fix/01-api", workspaceId: "ws-fix" });
    const workspace = legacyWorkspace("/company-b/hilo");

    const result = groupSidebarSessions(
      [sourceA, child, sourceB],
      [savedProject("hilo-a", "/company-a/hilo"), savedProject("hilo-b", "/company-b/hilo")],
      [workspace],
    );

    expect(result.projects).toHaveLength(2);
    const projectA = result.projects.find(project => project.projectId === "hilo-a")!;
    const projectB = result.projects.find(project => project.projectId === "hilo-b")!;
    expect(projectA.sessions.map(session => session.id)).toEqual(["source-a"]);
    expect(projectA.workspaces).toEqual([]);
    expect(projectB.sessions.map(session => session.id)).toEqual(["source-b"]);
    expect(projectB.workspaces).toHaveLength(1);
    expect(projectB.workspaces[0].info).toEqual(workspace);
    expect(projectB.workspaces[0].sessions.map(session => session.id)).toEqual(["child-b"]);
  });
});

describe("groupSidebarSessions", () => {
  it("keeps a CLI session in the project list and still hides the built-in coordinator session", () => {
    const project = savedProject("proj-1", "/work/hilo");
    const builtin = row({ id: "coordinator", projectId: "proj-1", label: "Coordinator session" });
    const external = row({ id: "external", projectId: "proj-1", label: "EVIDENCE_HELLO", externalClient: "cursor killer" });
    const ordinary = row({ id: "ordinary", projectId: "proj-1", label: "Project chat" });
    const grouped = groupSidebarSessions(
      [builtin, external, ordinary],
      [project],
      [],
      [],
      new Set(["coordinator"]),
    );
    expect(grouped.projects[0]?.sessions.map((session) => session.id)).toEqual(["external", "ordinary"]);
  });

  it("keeps durable coordinator sessions out of ordinary and pinned chat entries", () => {
    const coordinator = row({ id: "coordinator", pinnedAt: 1, projectId: "proj-1" });
    const ordinary = row({ id: "ordinary", label: "Project coordinator", projectScope: "none" });
    const grouped = groupSidebarSessions([coordinator, ordinary], [], [], [], new Set(["coordinator"]));
    expect(grouped.pinned).toEqual([]);
    expect(grouped.chats).toEqual([ordinary]);
  });

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

  it("nests workspace chats under a second-level node while live chats stay under the project", () => {
    const project = {
      id: "proj-1",
      name: "Backchat",
      primary_folder: "/work/backchat",
      source_folders: ["/work/backchat"],
    } as never;
    const workspace = {
      id: "ws-paging-1a2b",
      project_id: "proj-1",
      name: "paging",
      kind: "managed",
      branch: "backchat/paging-1a2b",
      roots: [{ sourcePath: "/work/backchat", effectivePath: "/wt/ws-paging-1a2b/01-backchat", worktreeIndex: 0 }],
      worktrees: [],
      created_by_session_id: null,
      created_at: 1,
      updated_at: 1,
    } as never;
    const live = row({ id: "live-chat", cwd: "/work/backchat", projectId: "proj-1", projectScope: "project" });
    const inWorkspace = row({
      id: "ws-chat",
      cwd: "/wt/ws-paging-1a2b/01-backchat",
      projectId: "proj-1",
      projectScope: "project",
      workspaceId: "ws-paging-1a2b",
    });
    const liveTagged = row({
      id: "live-tagged",
      cwd: "/work/backchat",
      projectId: "proj-1",
      projectScope: "project",
      workspaceId: "live:proj-1",
    });

    const idleExternal = {
      ...(workspace as Record<string, unknown>),
      id: "ext:abc",
      name: "codex/other-branch",
      kind: "external",
    } as never;
    const grouped = groupSidebarSessions(
      [live, inWorkspace, liveTagged],
      [project],
      [workspace, idleExternal],
    );

    expect(grouped.projects).toHaveLength(1);
    expect(grouped.projects[0].sessions.map((s) => s.id)).toEqual(["live-chat", "live-tagged"]);
    // Managed nodes always show; an external worktree without chats does not.
    expect(grouped.projects[0].workspaces).toMatchObject([
      { id: "ws-paging-1a2b", label: "paging", branch: "backchat/paging-1a2b", sessions: [{ id: "ws-chat" }] },
    ]);
    expect(grouped.projects[0].workspaces.map((w) => w.id)).not.toContain("ext:abc");
  });

  it("keeps a workspace chat in its owning project while starting and after reload without a session project id", () => {
    const project = { id: "hilo", name: "Hilo", primary_folder: "/source/hilo", source_folders: ["/source/hilo"] } as never;
    const workspace = { id: "ws-fix", project_id: "hilo", name: "fix", kind: "managed", roots: [], worktrees: [] } as never;
    for (const state of [
      { status: "starting" as const, cwd: "", chosenCwd: "/source/hilo", projectScope: "project" as const },
      { status: "ready" as const, cwd: "/worktrees/fix/01-repo" },
    ]) {
      const grouped = groupSidebarSessions([row({ ...state, workspaceId: "ws-fix" })], [project], [workspace]);
      expect(grouped.chats).toEqual([]);
      expect(grouped.projects).toHaveLength(1);
      expect(grouped.projects[0].workspaces[0].sessions.map(session => session.id)).toEqual(["sess-1"]);
    }
  });

  it("keeps older unowned workspaces with their existing source-directory project group", () => {
    const source = row({ id: "source", cwd: "/work/hilo" });
    const child = row({ id: "child", cwd: "/wt/fix/01-api", workspaceId: "ws-fix" });
    const workspace = { id: "ws-fix", project_id: null, name: "fix", kind: "managed", roots: [
      { sourcePath: "/work/hilo/api", effectivePath: "/wt/fix/01-api" },
      { sourcePath: "/work/hilo/web", effectivePath: "/wt/fix/02-web" },
    ], worktrees: [] } as never;
    const result = groupSidebarSessions([child, source], [], [workspace]);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].primaryRoot).toBe("/work/hilo");
    expect(result.projects[0].workspaces[0]).toMatchObject({ label: "fix", sessions: [{ id: "child" }] });
  });

  it("keeps chats visible under a placeholder node when their workspace record is gone", () => {
    const orphan = row({
      id: "orphan",
      cwd: "/wt/ws-gone/01-app",
      projectScope: "project",
      workspaceId: "ws-gone",
    });
    const grouped = groupSidebarSessions([orphan]);
    expect(grouped.projects[0].sessions).toEqual([]);
    expect(grouped.projects[0].workspaces).toMatchObject([
      { id: "ws-gone", label: "01-app", sessions: [{ id: "orphan" }] },
    ]);
  });

  it("creates global and project drafts with explicit, separate scopes", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");

    expect(source).toContain("sessionStore.newDraft();");
    expect(source).toContain("sourceFolders: project.sourceFolders,");
    expect(source).toContain("onNewProjectChat(project, ws.id)");
    expect(source).toContain('navigate({ to: "/" })');
  });

  it("uses closed and open folder icons for project disclosure state", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const projectRow = source.slice(
      source.indexOf("function ProjectSidebarRow"),
      source.indexOf("function PairSidebarRow"),
    );

    expect(source).toContain('openSectionKeys.has("projects") ? <FolderOpenIcon');
    expect(projectRow).toContain("<ProjectIcon");
  });

  it("reveals project actions on hover", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const projectRow = source.slice(
      source.indexOf("function ProjectSidebarRow"),
      source.indexOf("function PairSidebarRow"),
    );

    expect(projectRow).toContain('t("sidebar.projectActions")');
    expect(projectRow).toContain('t("sidebar.startProjectChat")');
    expect(projectRow).toContain("group-hover:opacity-100");
    expect(projectRow).toContain("<DropdownMenu");
    expect(projectRow).toContain('slot="trailing"');
    expect(projectRow).toContain("group-hover:opacity-100");
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

    expect(source).toContain("UsersRoundIcon");
    expect(source).not.toContain("LayoutGridIcon");
    expect(source).not.toContain("function PairChatLauncher");
  });

  it("exposes rename actions for sessions and pair chats", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const sessionRow = source.slice(
      source.indexOf("function SessionRow"),
      source.length,
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
      source.length,
    );

    expect(sessionRow).toContain('data-sidebar-schedule-indicator="true"');
    expect(sessionRow).toContain("pointer-events-none");
    expect(sessionRow).toContain("CalendarClockIcon");
    expect(sessionRow).toContain("opacity-0 group-hover:opacity-100");
  });

  it("keeps the removed standalone multi-Agent launcher absent", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");

    expect(source).not.toContain("<PairChatLauncher");
  });

  it("centers the settings row inside symmetric footer padding", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const footer = source.slice(source.indexOf("{/* Footer navigation and update affordance"));

    expect(footer).toContain('className="sidebar-footer-chrome shrink-0 pb-2 pt-[var(--bottom-bar-gap-y)]"');
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
    const footerStart = source.indexOf("{/* Footer navigation and update affordance");
    const footer = source.slice(
      footerStart,
      source.indexOf("<Dialog open={projectAction", footerStart),
    );

    expect(footer).toContain('to="/settings/activity"');
    expect(footer).toContain("<AgentUpdateControl agents={agents} />");
    expect(footer).toContain("SidebarGridRow trailingTrack=\"host\"");
    expect(footer).not.toContain("overflow-hidden rounded-md");
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

  it("routes every sidebar row type through the shared grid mesh", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );

    expect(styles).toContain("--scrollbar-thumb:");
    expect(styles).toContain("--sidebar-row-surface-inset:");
    expect(styles).toContain("--sidebar-grid-icon-track:");
    expect(styles).toContain("grid-template-columns:");
    for (const component of [
      "function SidebarSection",
      "function ProjectSidebarRow",
      "function ProjectCoordinatorRow",
      "function WorkspaceSidebarRow",
      "function PairSidebarRow",
      "function SessionRow",
    ]) {
      const start = source.indexOf(component);
      expect(start).toBeGreaterThan(-1);
      const block = source.slice(start, start + 3200);
      expect(
        block.includes("SidebarGridRow") || block.includes("sidebar-grid-row"),
      ).toBe(true);
    }
    expect(source).toContain("sidebar-host-chrome");
    expect(source).toContain("sidebar-footer-chrome");
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

  it("aligns section header trailing actions with row content inset tokens", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const section = source.slice(
      source.indexOf("function SidebarSection"),
      source.indexOf("function ProjectSidebarRow"),
    );

    expect(styles).toContain("--sidebar-content-padding-inline-start");
    expect(styles).toContain("--sidebar-content-padding-inline-end");
    expect(styles).toContain(".sidebar-grid-row");
    expect(styles).toContain('[data-sidebar-grid="trailing"]');
    expect(section).toContain("data-sidebar-section-header-action");
    expect(section).toContain("sidebar-section-header group/section");
    expect(section).toContain("SidebarGridRow");
    expect(section).toContain('slot="trailing"');
    expect(section).not.toContain("mr-1 shrink-0");
    expect(section).not.toContain("sidebar-section-header-trailing");
    expect(styles).toContain(".sidebar-section-header .sidebar-row-action > svg");
  });

  it("puts the running spinner in the same reserved trailing slot as the schedule clock", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const sessionRow = source.slice(
      source.indexOf("function SessionRow"),
      source.length,
    );
    const trailing = sessionRow.slice(sessionRow.indexOf('slot="trailing"'));

    expect(styles).toContain("--sidebar-grid-trailing-gap:");
    expect(styles).toContain('data-sidebar-trailing-track="double"');
    expect(sessionRow).toContain('SidebarGridCell slot="trailing"');
    expect(sessionRow).toContain('data-sidebar-grid-action="last"');
    expect(trailing).toContain("{running ?");
    expect(trailing.indexOf("Loader2Icon")).toBeGreaterThan(trailing.indexOf('slot="trailing"'));
    expect(trailing.indexOf("data-sidebar-schedule-indicator")).toBeGreaterThan(
      trailing.indexOf("Loader2Icon"),
    );
  });

  it("renders a dedicated Pinned section before every other conversation section", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");

    const pinnedSection = source.indexOf("{pinned.length > 0 && (");
    const pairSection = source.indexOf("{pairs.length > 0 && (");
    const projectSection = source.indexOf("{projects.length > 0 && (");
    const chatSection = source.indexOf('title={t("sidebar.chats")}', pinnedSection);

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

  it("shows assigned chats only in their custom section", () => {
    const projectChat = row({ id: "project-chat", cwd: "/work/atlas", projectId: "atlas" });
    const standalone = row({ id: "standalone", cwd: "", projectScope: "none" });
    const grouped = groupSidebarSessions(
      [projectChat, standalone],
      [savedProject("atlas", "/work/atlas")],
      [],
      [],
      new Set(),
      [{ id: "focus", name: "Focus", sessionIds: ["project-chat", "standalone"] }],
    );

    expect(grouped.customSections).toEqual([
      { id: "focus", name: "Focus", sessions: [projectChat, standalone] },
    ]);
    expect(grouped.projects[0].sessions).toEqual([]);
    expect(grouped.chats).toEqual([]);
  });
});


describe("removed projects", () => {
  it("keeps existing chats accessible without recreating a removed project", () => {
    const chat = row({ cwd: "/work/removed", projectId: "removed" });
    expect(groupSidebarSessions([chat], [], [], ["/work/removed"])).toMatchObject({ projects: [], chats: [chat] });
  });
  it("lets an explicitly re-added folder appear again", () => {
    const chat = row({ cwd: "/work/removed", projectId: "removed" });
    const project = { id: "again", name: "Again", primary_folder: "/work/removed", source_folders: ["/work/removed"] } as never;
    expect(groupSidebarSessions([chat], [project], [], ["/work/removed"]).projects).toHaveLength(1);
  });
  it("keeps a removed project's worktree chats outside project groups", () => {
    const chat = row({ cwd: "/wt/feature", workspaceId: "ws" });
    const workspace = { id: "ws", project_id: "removed", kind: "managed", roots: [{ sourcePath: "/work/removed", effectivePath: "/wt/feature" }] } as never;
    expect(groupSidebarSessions([chat], [], [workspace], ["/work/removed"])).toMatchObject({ projects: [], chats: [chat] });
  });
});
