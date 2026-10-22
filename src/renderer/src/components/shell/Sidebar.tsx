import { useProjects } from "@/lib/projects-query";
import { ProjectIcon } from "@/components/ProjectIcon";
import { MoreIcon as MoreHorizontalIcon, PinIcon as PinIcon, PinOffIcon as PinOffIcon, SearchIcon as SearchIcon, SettingsIcon as Settings2Icon, ComposeIcon as SquarePenIcon, ArchiveIcon as ArchiveIcon, ScheduleIcon as CalendarClockIcon, FolderOpenIcon as FolderOpenIcon, BranchIcon as GitBranchIcon, PlusIcon as PlusIcon, TrashIcon as Trash2Icon, ParticipantsIcon as UsersRoundIcon, CoordinationIcon as WorkflowIcon } from "@/components/BackchatIcons";
import { rememberRemovedProject, useRemovedProjectPaths } from "@/lib/removed-projects";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { openmaWorkspaceScope } from "@shared/openma";
import { useOpenmaAccount, useOpenmaCatalog } from "@/lib/openma-account";
import { sameOpenmaScope, useOpenmaTenantTasks } from "@/lib/openma-tasks";
import { openmaTargets } from "@/lib/openma-targets";
import type { OpenmaScope } from "@shared/openma";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyIcon } from "@/components/Icons";
import { toast } from "sonner";
import {
  Loader2Icon,
} from "@/components/Icons";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { sidebarNavRowClass } from "@/lib/sidebar-nav-row";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings-store";
import {
  selectActiveId,
  selectPairs,
  selectSessions,
  sessionStore,
  useSessionStore,
  type PairRow,
  type SessionRow as SessionRowData,
} from "@/lib/session-store";
import { AgentIcon } from "@/components/AgentIcon";
import { ExternalSourceBadge } from "@/components/shell/ExternalSourceBadge";
import { AnimatedCollapse } from "@/components/ui/animated-collapse";
import { RepositoryMenuItems, RowContextMenu, RowMoreMenu, type RowMenu } from "./sidebar-menus";
import { SidebarHoverCard, type SidebarCardSpec } from "./SidebarHoverCard";
import { gitUpstreamQuery } from "./RepositoryHoverCard";
import { pushRecent } from "./CommandPalette";
import { DisclosureCaret } from "@/components/ui/disclosure-caret";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSidebarCollapse } from "@/components/shell/AppShell";
import {
  SidebarGridCell,
  SidebarGridRow,
  type SidebarGridDepth,
} from "@/components/shell/SidebarGridRow";
import { SidebarSectionHeading } from "@/components/shell/SidebarSectionHeading";
import { folderName, projectKeyForCwd } from "@/lib/project-path";
import { useI18n } from "@/lib/i18n";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";
import { SCHEDULES_QUERY_KEY, scheduledSourceSessionIds } from "@/lib/scheduled-task-presentation";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { RenameDialog } from "./RenameDialog";
import {
  ArchiveScheduledChatDialog,
  useArchiveSessions,
} from "./ArchiveScheduledChatDialog";
import { AgentUpdateControl } from "./AgentUpdateControl";
import { RuntimeLocationControl } from "@/components/chat/RuntimeLocationControl";
import type { ProjectInfo } from "@shared/projects.js";
import { isLiveWorkspaceId, type WorkspaceInfo } from "@shared/workspaces";
import { WORKSPACES_QUERY_KEY } from "@/lib/workspace-query";

function readDisclosureKeys<T extends string>(key: string, fallback: T[]): Set<T> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(value) && value.every(item => typeof item === "string")) return new Set(value as T[]);
  } catch { /* Keep defaults if storage is unavailable. */ }
  return new Set(fallback);
}
function saveDisclosureKeys(key: string, keys: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...keys])); } catch { /* In-memory state still works. */ }
}
const CUSTOM_SECTIONS_KEY = "backchat:custom-sidebar-sections:v1";
/** Above this many child rows, project/worktree groups skip the grid-row
 *  height animation (which relayouts the whole subtree every frame) and only
 *  fade, so collapsing a busy project stays instant. */
const LIGHTWEIGHT_COLLAPSE_THRESHOLD = 12;
function readCustomSections(): SidebarCustomSection[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CUSTOM_SECTIONS_KEY) ?? "null");
    if (!Array.isArray(value)) return [];
    return value.filter((section): section is SidebarCustomSection =>
      section !== null && typeof section === "object"
      && typeof section.id === "string" && typeof section.name === "string"
      && Array.isArray(section.sessionIds)
      && section.sessionIds.every((id: unknown) => typeof id === "string"));
  } catch { return []; }
}
let lastRevealedSession: string | null = null;

/** Second-level sidebar node: one managed/external workspace of a project
 *  and the chats running inside it. Live-workspace chats stay directly
 *  under the project and never form a node. */
export interface SidebarWorkspaceGroup {
  id: string;
  label: string;
  kind: WorkspaceInfo["kind"];
  branch: string | null;
  /** Checkout directories, primary first. */
  paths: string[];
  sessions: SessionRowData[];
  /** Full record when the workspace is still known to the main process. */
  info?: WorkspaceInfo;
}

export interface SidebarProjectGroup {
  key: string;
  label: string;
  /** Chats in the live workspace (the project's own source folders). */
  sessions: SessionRowData[];
  workspaces: SidebarWorkspaceGroup[];
  projectId?: string;
  primaryRoot: string;
  sourceFolders: string[];
}

export interface SidebarCustomSection {
  id: string;
  name: string;
  sessionIds: string[];
}

function workspaceGroupFromInfo(info: WorkspaceInfo): SidebarWorkspaceGroup {
  return {
    id: info.id,
    label: info.name,
    kind: info.kind,
    branch: info.branch,
    paths: info.roots.map((root) => root.effectivePath),
    sessions: [],
    info,
  };
}

function attachWorkspaceSession(
  group: SidebarProjectGroup,
  session: SessionRowData,
  workspaceId: string,
): void {
  let ws = group.workspaces.find((w) => w.id === workspaceId);
  if (!ws) {
    // Workspace record is gone (or not loaded yet): still show the chats
    // under a node named after their checkout so nothing disappears.
    ws = {
      id: workspaceId,
      label: folderName(session.cwd) || workspaceId,
      kind: "managed",
      branch: null,
      paths: [session.cwd, ...(session.additionalDirectories ?? [])].filter(Boolean),
      sessions: [],
    };
    group.workspaces.push(ws);
  }
  ws.sessions.push(session);
}

type SidebarSectionKey = "pinned" | "pairs" | "projects" | "chats";
type RenameTarget = {
  kind: "session" | "pair";
  id: string;
  title: string;
};

export function groupSidebarSessions(
  sessions: SessionRowData[],
  savedProjects: readonly ProjectInfo[] = [],
  workspaces: readonly WorkspaceInfo[] = [],
  removedPaths: readonly string[] = [],
  coordinatorSessionIds: ReadonlySet<string> = new Set(),
  sections: readonly SidebarCustomSection[] = [],
): {
  pinned: SessionRowData[];
  projects: SidebarProjectGroup[];
  chats: SessionRowData[];
  customSections: Array<{ id: string; name: string; sessions: SessionRowData[] }>;
} {
  const pinned: SessionRowData[] = [];
  const chats: SessionRowData[] = [];
  const customSections = sections.map(({ id, name }) => ({ id, name, sessions: [] as SessionRowData[] }));
  const customById = new Map(customSections.map((section) => [section.id, section]));
  const assignedSection = new Map<string, string>();
  for (const section of sections) for (const id of section.sessionIds) {
    if (!assignedSection.has(id)) assignedSection.set(id, section.id);
  }
  const projectMap = new Map<string, SidebarProjectGroup>();
  for (const project of savedProjects) {
    projectMap.set(`project:${project.id}`, {
      key: `project:${project.id}`,
      label: project.name,
      sessions: [],
      workspaces: [],
      projectId: project.id,
      primaryRoot: project.primary_folder,
      sourceFolders: project.source_folders,
    });
  }
  const workspaceProjectKeys = new Map<string, string>();
  for (const ws of workspaces) {
    if (ws.kind === "live") continue;
    if (ws.roots.some(root => removedPaths.includes(root.sourcePath))
      && !savedProjects.some(project => project.id === ws.project_id || project.source_folders.some(path => ws.roots.some(root => root.sourcePath === path)))) continue;
    let key = ws.project_id && projectMap.has(`project:${ws.project_id}`)
      ? `project:${ws.project_id}` : undefined;
    if (!key && ws.roots.length) {
      // A directory group may have become a saved project since this workspace
      // was created. Resolve its source roots before creating a legacy group;
      // checkout paths and display names are not project identities.
      const candidates = savedProjects.map(project => {
        const coverage = ws.roots.map(root => Math.max(-1, ...project.source_folders
          .map(folder => folder.replace(/\/$/, ""))
          .filter(folder => root.sourcePath === folder || root.sourcePath.startsWith(`${folder}/`))
          .map(folder => folder.length)));
        return { project, specificity: Math.min(...coverage) };
      }).filter(candidate => candidate.specificity >= 0)
        .sort((a, b) => b.specificity - a.specificity);
      if (candidates[0]) key = `project:${candidates[0].project.id}`;
    }
    if (!key && ws.roots.length) {
      // Older directory-based projects may exist only as source-session groups.
      // Use the closest existing group covering every source root, never the
      // generated checkout directory as a new project.
      const source = sessions.filter(session => !session.workspaceId
        && session.projectScope !== "none" && session.cwd
        && ws.roots.every(root => root.sourcePath === session.cwd
          || root.sourcePath.startsWith(`${session.cwd.replace(/\/$/, "")}/`)))
        .sort((a, b) => b.cwd.length - a.cwd.length)[0];
      if (source) {
        key = projectKeyForCwd(source.cwd) ?? undefined;
        if (key && !projectMap.has(key)) projectMap.set(key, {
          key, label: folderName(source.cwd), sessions: [], workspaces: [],
          primaryRoot: source.cwd, sourceFolders: [source.cwd, ...(source.additionalDirectories ?? [])],
        });
      }
    }
    if (key && projectMap.has(key)) {
      workspaceProjectKeys.set(ws.id, key);
      projectMap.get(key)!.workspaces.push(workspaceGroupFromInfo(ws));
    }
  }

  for (const session of sessions) {
    if (coordinatorSessionIds.has(session.id) || session.listHidden) continue;
    if (session.pinnedAt != null) {
      pinned.push(session);
      continue;
    }
    const custom = customById.get(assignedSection.get(session.id) ?? "");
    if (custom) {
      custom.sessions.push(session);
      continue;
    }

    if (session.projectScope === "none") {
      chats.push(session);
      continue;
    }

    const workspace = workspaces.find(workspace => workspace.id === session.workspaceId);
    const workspaceOwner = workspace?.project_id;
    const sourcePath = session.chosenCwd || session.cwd;
    const sourceOwner = savedProjects.find(project => project.source_folders.includes(sourcePath))?.id;
    if (!sourceOwner && !savedProjects.some(p => p.id === workspaceOwner)
      && (removedPaths.includes(sourcePath) || workspace?.roots.some(r => removedPaths.includes(r.sourcePath)))) {
      chats.push(session);
      continue;
    }
    const namedProjectKey = [
      session.projectId ? `project:${session.projectId}` : null,
      workspaceProjectKeys.get(session.workspaceId ?? ""),
      sourceOwner ? `project:${sourceOwner}` : null,
    ].find(key => key && projectMap.has(key));
    const projectKey =
      namedProjectKey && projectMap.has(namedProjectKey)
        ? namedProjectKey
        : projectKeyForCwd(sourcePath);
    if (!projectKey) {
      chats.push(session);
      continue;
    }

    const workspaceId =
      session.workspaceId && !isLiveWorkspaceId(session.workspaceId)
        ? session.workspaceId
        : null;
    const group = projectMap.get(projectKey);
    if (group) {
      if (workspaceId) attachWorkspaceSession(group, session, workspaceId);
      else group.sessions.push(session);
    } else {
      const fresh: SidebarProjectGroup = {
        key: projectKey,
        label: folderName(projectKey),
        sessions: [],
        workspaces: [],
        primaryRoot: session.cwd,
        sourceFolders: [
          session.cwd,
          ...(session.additionalDirectories ?? []),
        ].filter(Boolean),
      };
      if (workspaceId) attachWorkspaceSession(fresh, session, workspaceId);
      else fresh.sessions.push(session);
      projectMap.set(projectKey, fresh);
    }
  }

  // External worktrees are only worth a sidebar node once a chat runs in
  // them; otherwise they stay reachable through the composer's workspace
  // picker and do not turn every `git worktree list` entry into UI.
  for (const group of projectMap.values()) {
    group.workspaces = group.workspaces.filter(
      (ws) => ws.kind !== "external" || ws.sessions.length > 0,
    );
  }
  pinned.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  return {
    pinned,
    projects: [...projectMap.values()],
    chats,
    customSections,
  };
}

/** Short worktree name. A managed workspace goes by the name
 *  the user gave it (its branch is generated, e.g. `backchat/fix-abc-7c6f`);
 *  an external worktree goes by its branch. The "project · " prefix legacy
 *  names repeat is dropped. */
export function workspaceMetaLabel(workspace: SidebarWorkspaceGroup): string {
  if (workspace.kind === "external" && workspace.branch) return workspace.branch;
  const parts = workspace.label.split(" · ");
  return parts[parts.length - 1] || workspace.branch || workspace.label;
}

/** Folder that "reveal worktree" opens. A multi-repo workspace keeps one
 *  checkout per repository under a shared directory (`ws-…/01-a`,
 *  `ws-…/02-b`); revealing the first checkout opened the same repository
 *  for every worktree. Reveal the shared directory instead; a single
 *  checkout is its own folder. */
export function workspaceRevealPath(workspace: Pick<SidebarWorkspaceGroup, "paths">): string | undefined {
  const paths = workspace.paths.filter(Boolean);
  if (paths.length <= 1) return paths[0];
  const split = paths.map((path) => path.replace(/\/+$/, "").split("/"));
  const common: string[] = [];
  for (let i = 0; split.every((parts) => i < parts.length - 1 && parts[i] === split[0]![i]); i += 1) {
    common.push(split[0]![i]!);
  }
  const shared = common.join("/");
  return shared && shared !== "" ? shared : paths[0];
}

/**
 * Sidebar — top row is a drag region reserved for macOS trafficLight
 * (the red/yellow/green chrome IS the brand mark; we don't draw a logo).
 * Below that: + New chat (button row), Search (Cmd+K trigger), then the
 * scrollable chat list. Bottom: Settings link + theme toggle.
 *
 * Cold-create flow: clicking "+ New chat" creates an in-memory global draft
 * and navigates to its empty composer. No IPC fires until the first prompt.
 * Project `+` uses the same draft path with an explicit project scope, so
 * ownership never depends on whichever session happened to be active before.
 *
 * Everything horizontal pulls from --page-pl so it lines up with the
 * card's first column across the seam. Everything vertical pulls from
 * --row-h / --row-gap-y so heights match the card's toolbar.
 */
export function Sidebar() {
  const { t } = useI18n();
  const sessions = useSessionStore(selectSessions);
  const pairs = useSessionStore(selectPairs);
  const activeId = useSessionStore(selectActiveId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { collapsed } = useSidebarCollapse();
  const { data: agents = [] } = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: () => window.backchat.agentsList(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const agentIconUrls = useMemo(
    () => new Map(agents.flatMap((agent) => agent.icon ? [[agent.id, agent.icon] as const] : [])),
    [agents],
  );
  // Single menu state for the whole sidebar — only one row's `…`
  // dropdown can be open at a time. Lifting this up avoids the
  // "right-click row A then row B leaves both menus open" bug.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const removedPaths = useRemovedProjectPaths();
  const [projectAction, setProjectAction] = useState<{ kind: "archive" | "remove"; project: SidebarProjectGroup } | null>(null);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const projectChatIds = projectAction ? [...new Set([
    ...projectAction.project.sessions,
    ...projectAction.project.workspaces.flatMap(w => w.sessions),
    ...sessions.filter(s => !s.openma && !s.executionTarget && s.projectScope !== "none"
      && ((projectAction.project.projectId && s.projectId === projectAction.project.projectId)
        || projectAction.project.sourceFolders.includes(s.chosenCwd || s.cwd)
        || projectAction.project.workspaces.some(w => w.id === s.workspaceId))),
  ].map(s => s.id))] : [];
  const confirmProjectAction = async () => {
    if (!projectAction || projectActionBusy) return;
    setProjectActionBusy(true);
    try {
      if (projectAction.kind === "archive") {
        await requestArchive(projectChatIds);
      } else {
        const project = projectAction.project;
        if (project.projectId) await window.backchat.projectDelete({ project_id: project.projectId });
        rememberRemovedProject(project.sourceFolders);
        queryClient.setQueryData<ProjectInfo[]>(["projects"], old => old?.filter(p => p.id !== project.projectId) ?? []);
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        await queryClient.invalidateQueries({ queryKey: ["sessions-for-recent-cwds"] });
        const active = sessionStore.get(activeId ?? "");
        if (active?.status === "draft" && ((project.projectId && active.projectId === project.projectId)
          || project.sourceFolders.includes(active.chosenCwd || active.cwd))) sessionStore.newDraft();
      }
      setProjectAction(null);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setProjectActionBusy(false); }
  };
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const {
    pending: pendingArchive,
    requestArchive,
    confirmArchive,
    cancelArchive,
  } = useArchiveSessions();
  const [openProjectKeys, setOpenProjectKeys] = useState<Set<string>>(
    () => readDisclosureKeys("backchat:sidebar-projects:v1", []),
  );
  const [openSectionKeys, setOpenSectionKeys] = useState<Set<SidebarSectionKey>>(
    () => readDisclosureKeys("backchat:sidebar-sections:v1", ["pinned", "pairs", "projects", "chats"]),
  );
  useEffect(() => saveDisclosureKeys("backchat:sidebar-projects:v1", openProjectKeys), [openProjectKeys]);
  const [customSections, setCustomSections] = useState(readCustomSections);
  const [closedCustomSectionIds, setClosedCustomSectionIds] = useState<Set<string>>(
    () => readDisclosureKeys("backchat:closed-custom-sidebar-sections:v1", []),
  );
  const [sectionDialog, setSectionDialog] = useState<{ kind: "create" } | { kind: "rename"; id: string } | null>(null);
  const [sectionName, setSectionName] = useState("");
  const [deleteSectionId, setDeleteSectionId] = useState<string | null>(null);
  useEffect(() => saveDisclosureKeys("backchat:sidebar-sections:v1", openSectionKeys), [openSectionKeys]);
  useEffect(() => { try { localStorage.setItem(CUSTOM_SECTIONS_KEY, JSON.stringify(customSections)); } catch { /* In-memory state still works. */ } }, [customSections]);
  useEffect(() => saveDisclosureKeys("backchat:closed-custom-sidebar-sections:v1", closedCustomSectionIds), [closedCustomSectionIds]);
  useEffect(() => {
    if (!location.pathname.startsWith("/projects/")) return;
    const key = `project:${location.pathname.slice("/projects/".length)}`;
    setOpenProjectKeys(current => current.has(key) ? current : new Set(current).add(key));
    setOpenSectionKeys(current => current.has("projects") ? current : new Set(current).add("projects"));
  }, [location.pathname]);
  const { data: savedProjects = [] } = useProjects();
  // Resolve ownership from durable project bindings, never from agent-generated titles.
  const coordinatorViews = useQueries({
    queries: savedProjects.map(project => ({
      queryKey: ["project-work", project.id],
      queryFn: () => window.backchat.projectWorkView(project.id),
      staleTime: 30_000,
      select: (view: import("@shared/project-work").ProjectWorkView) => ({
        projectId: project.id,
        hasCoordinator: !!view.config?.coordinatorAgent,
        coordinatorAgent: view.config?.coordinatorAgent,
        sessionIds: view.facts.sessions.filter(session => session.agentId === "coordinator").map(session => session.id),
      }),
    })),
  });
  const coordinatorSessionIds = new Set(coordinatorViews.flatMap(view => view.data?.sessionIds ?? []));
  const coordinatorsByProject = new Map(coordinatorViews.flatMap(view => view.data ? [[view.data.projectId, view.data] as const] : []));
  const { data: workspaces = [] } = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: () => window.backchat.workspacesList(),
    staleTime: 30_000,
  });
  const scheduledSessionIds = scheduledSourceSessionIds(
    useQuery({
      queryKey: SCHEDULES_QUERY_KEY,
      queryFn: () => window.backchat.schedulesList(),
      staleTime: 5_000,
      refetchInterval: 4_000,
    }).data ?? [],
  );
  const { data: openmaAccount } = useOpenmaAccount();
  const localSessions = useMemo(() => sessions.filter((row) => !row.openma && !row.executionTarget), [sessions]);
  const grouped = useMemo(
    () => groupSidebarSessions(localSessions, savedProjects, workspaces, removedPaths, coordinatorSessionIds, customSections),
    [savedProjects, localSessions, workspaces, removedPaths, customSections, [...coordinatorSessionIds].sort().join(",")],
  );

  const goHome = () => {
    sessionStore.newDraft();
    void navigate({ to: "/" });
  };

  const onSelectSession = (id: string) => {
    sessionStore.setActive(id);
    pushRecent(id);
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
  };

  const onSelectPair = (id: string) => {
    sessionStore.setActive(null);
    void navigate({ to: "/pair/$pairId", params: { pairId: id } });
  };

  const requestRename = (target: RenameTarget) => {
    setOpenMenuId(null);
    setRenameTarget(target);
  };

  const submitRename = async (title: string) => {
    if (!renameTarget) return;
    if (renameTarget.kind === "session") {
      await sessionStore.rename(renameTarget.id, title);
    } else {
      await sessionStore.renamePair(renameTarget.id, title);
    }
  };

  const projectOpening = useRef(new Map<string, Promise<void>>());
  const onOpenProject = (group: SidebarProjectGroup): Promise<void> => {
    const pending = projectOpening.current.get(group.key);
    if (pending) return pending;
    // Legacy directory groups become the same durable Project when first opened.
    // Their existing sessions keep their IDs and remain grouped by their source paths.
    const opening = (async () => {
      try {
        const projects = await window.backchat.projectsList();
        const existing = projects.find(project => project.id === group.projectId)
          ?? projects.find(project => project.primary_folder === group.primaryRoot
            && group.sourceFolders.every(folder => project.source_folders.includes(folder)));
        const project = existing ?? await window.backchat.projectSave({
          project_id: `proj-${crypto.randomUUID()}`,
          name: group.label,
          source_folders: group.sourceFolders,
          primary_folder: group.primaryRoot,
        });
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        setOpenProjectKeys(current => {
          const next = new Set(current);
          next.delete(group.key);
          next.add(`project:${project.id}`);
          return next;
        });
        await navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        projectOpening.current.delete(group.key);
      }
    })();
    projectOpening.current.set(group.key, opening);
    return opening;
  };

  const onNewProjectChat = (
    project: SidebarProjectGroup,
    workspaceId?: string,
  ) => {
    sessionStore.newDraft({
      projectId: project.projectId,
      sourceFolders: project.sourceFolders,
      workspaceId,
    });
    void navigate({ to: "/" });
  };
  const onDeleteWorkspace = async (ws: SidebarWorkspaceGroup) => {
    try {
      await window.backchat.workspaceDelete({ workspace_id: ws.id });
      void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const settingsActive = location.pathname.startsWith("/settings");
  const scheduledActive = location.pathname === "/scheduled";
  const activePairId = location.pathname.startsWith("/pair/")
    ? decodeURIComponent(location.pathname.slice("/pair/".length))
    : null;
  const onHome = location.pathname === "/";
  const activeRow = activeId ? sessionStore.get(activeId) : undefined;
  const newChatActive =
    onHome ||
    (activeRow?.status === "draft" && activeRow.projectScope === "none");
  useEffect(() => {
    if (!activeId || lastRevealedSession === activeId) return;
    const activeProject = grouped.projects.find((group) =>
      group.sessions.some((session) => session.id === activeId)
      || group.workspaces.some(workspace => workspace.id === activeRow?.workspaceId
        || workspace.sessions.some(session => session.id === activeId)),
    );
    if (!activeProject) return;
    lastRevealedSession = activeId;
    setOpenProjectKeys((prev) => {
      if (prev.has(activeProject.key)) return prev;
      const next = new Set(prev);
      next.add(activeProject.key);
      return next;
    });
  }, [activeId, activeRow?.workspaceId, grouped.projects]);

  const toggleProject = (key: string) => {
    setOpenProjectKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSection = (key: SidebarSectionKey) => {
    setOpenSectionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const openSectionDialog = (kind: "create" | "rename", section?: SidebarCustomSection) => {
    setSectionName(section?.name ?? "");
    setSectionDialog(kind === "create" ? { kind } : { kind, id: section!.id });
  };
  const saveSection = () => {
    const name = sectionName.trim();
    if (!name || !sectionDialog || customSections.some(section =>
      section.name.toLocaleLowerCase() === name.toLocaleLowerCase()
      && (sectionDialog.kind === "create" || section.id !== sectionDialog.id))) return;
    if (sectionDialog.kind === "create") {
      setCustomSections(current => [...current, { id: crypto.randomUUID(), name, sessionIds: [] }]);
    } else {
      const id = sectionDialog.id;
      setCustomSections(current => current.map(section => section.id === id ? { ...section, name } : section));
    }
    setSectionDialog(null);
  };
  const moveSessionToSection = async (sessionId: string, sectionId: string | null) => {
    if (sectionId && sessionStore.get(sessionId)?.pinnedAt != null) {
      try { await sessionStore.unpin(sessionId); }
      catch (error) { toast.error(String(error)); return; }
    }
    setCustomSections(current => current.map(section => ({
      ...section,
      sessionIds: [
        ...section.sessionIds.filter(id => id !== sessionId),
        ...(section.id === sectionId ? [sessionId] : []),
      ],
    })));
    if (sectionId) setClosedCustomSectionIds(current => {
      const next = new Set(current);
      next.delete(sectionId);
      return next;
    });
  };
  const sectionRowProps = { sections: customSections, onMoveToSection: moveSessionToSection };
  const renderProjectSession = (s: SessionRowData) => (
    <SessionRow
      row={s}
      {...sectionRowProps}
      depth={1}
      agentIconUrl={agentIconUrls.get(s.agent_id)}
      active={s.id === activeId && location.pathname.startsWith("/chat/")}
      hasSchedule={scheduledSessionIds.has(s.id)}
      labelCls={labelCls}
      onSelect={() => onSelectSession(s.id)}
      onRename={() => requestRename({ kind: "session", id: s.id, title: s.label })}
      onArchive={() => void requestArchive([s.id])}
      menuOpen={openMenuId === s.id}
      onMenuOpenChange={(openMenu) => setOpenMenuId(openMenu ? s.id : null)}
    />
  );

  // Hide labels while collapsed; AppShell overflow-hidden clips during expand
  // so icons and labels appear together with the rail width animation.
  const labelCls = cn(collapsed && "hidden", "truncate");

  const newConversationAction = (
    <button
      type="button"
      aria-label={t("sidebar.newConversation")}
      title={t("sidebar.newConversation")}
      data-sidebar-grid-action="last"
      className="sidebar-row-action app-no-drag"
      onClick={goHome}
    >
      <SquarePenIcon aria-hidden="true" />
    </button>
  );

  const sidebarRootRef = useRef<HTMLDivElement | null>(null);
  const agentLabel = (agentId: string | undefined) =>
    agentId ? agents.find((agent) => agent.id === agentId)?.label ?? agentId : undefined;
  const uniquePaths = (paths: readonly (string | null | undefined)[]) =>
    [...new Set(paths.filter((path): path is string => !!path))];
  // Rows carry data-sidebar-card="<kind>:<id>"; the one sidebar card resolves
  // it against live state when it opens, so it never shows a stale title.
  const resolveCard = (key: string): SidebarCardSpec | null => {
    const kind = key.slice(0, key.indexOf(":"));
    const id = key.slice(kind.length + 1);
    if (kind === "project") {
      const project = grouped.projects.find((item) => item.key === id);
      return project
        ? { kind: "repository", title: project.label, paths: uniquePaths([project.primaryRoot, ...project.sourceFolders]) }
        : null;
    }
    if (kind === "workspace") {
      for (const project of grouped.projects) {
        const workspace = project.workspaces.find((item) => item.id === id);
        if (workspace) {
          return { kind: "repository", title: `${t("workspace.picker")} · ${workspaceMetaLabel(workspace)}`, paths: uniquePaths(workspace.paths) };
        }
      }
      return null;
    }
    if (kind === "session") {
      const row = sessionStore.get(id);
      return row
        ? {
            kind: "session",
            title: row.label,
            agent: agentLabel(row.agent_id),
            cwd: row.chosenCwd || row.cwd || undefined,
            error: row.status === "errored" ? row.lastError : undefined,
          }
        : null;
    }
    if (kind === "pair") {
      const pair = pairs.find((item) => item.id === id);
      return pair
        ? { kind: "pair", title: pair.label, members: pair.members.map((member) => agentLabel(sessionStore.get(member)?.agent_id) ?? member) }
        : null;
    }
    return null;
  };
  const warmCard = (key: string) => {
    const spec = resolveCard(key);
    if (spec?.kind === "repository" && spec.paths.length > 0) {
      void queryClient.prefetchQuery(gitUpstreamQuery(spec.paths));
    }
  };

  return (
    <div ref={sidebarRootRef} className="sidebar-navigation flex h-full min-h-0 flex-col">
      <SidebarHoverCard rootRef={sidebarRootRef} resolve={resolveCard} onCandidate={warmCard} />
      {/* TrafficLight drag region — just empty space inside the sidebar
          card so the macOS-drawn trafficLight (at window x=16, y=18)
          has visible padding inside the card's rounded top-left. The
          global toggle button (rendered in AppShell) is absolute-
          positioned just to the right of the trafficLight; we don't
          host it here so it stays in place when the sidebar collapses. */}
      <div className="app-drag-region h-9 shrink-0" />

      {/* Header actions and conversation rows share one fixed 8px inset. The
          product-owned scrollbar overlays the viewport and reserves no gutter. */}
      <div className="sidebar-host-chrome shrink-0 pt-[var(--row-gap-y)]">
        <SidebarGridRow
          trailingTrack="double"
          data-sidebar-row="new-chat"
          className="rounded-md text-ui text-fg-subtle"
        >
          <button
            type="button"
            data-testid="new-chat-button"
            onClick={goHome}
            aria-label={t("sidebar.newChat")}
            aria-current={newChatActive ? "page" : undefined}
            className={cn(
              "sidebar-new-chat-primary app-no-drag text-ui transition-colors",
              // No selected wash on this row, so "current page" must not darken
              // the text either; it would read as a heavier weight.
              "text-fg-subtle hover:text-fg",
            )}
          >
            <SidebarGridCell slot="icon">
              <span className="sidebar-row-icon">
                <SquarePenIcon className="size-3.5" />
              </span>
            </SidebarGridCell>
            <SidebarGridCell slot="label" className="min-w-0">
              <span className={cn("min-w-0 truncate", labelCls)}>{t("sidebar.newChat")}</span>
            </SidebarGridCell>
          </button>
          <SidebarGridCell slot="trailing">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
              aria-label={t("sidebar.search")}
              title={`${t("sidebar.search")} (⌘K)`}
              data-sidebar-grid-action="penultimate"
              className="app-no-drag sidebar-row-action"
            >
              <SearchIcon aria-hidden="true" />
            </button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("sidebar.sidebarOptions")}
                  data-sidebar-grid-action="last"
                  className="app-no-drag sidebar-row-action"
                >
                  <MoreHorizontalIcon aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onSelect={() => openSectionDialog("create")}>
                  <PlusIcon className="size-3.5" />{t("sidebar.newSection")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarGridCell>
        </SidebarGridRow>
      </div>
      <ScrollArea
        type="always"
        showBoundaries
        data-sidebar-scroll-area="true"
        className="sidebar-scroll-area min-h-0 flex-1"
      >
      <div className="sidebar-content-inset">
        <Link
          to="/scheduled"
          aria-label={t("sidebar.scheduled")}
          className={cn(
            "app-no-drag sidebar-grid-row mt-0.5 rounded-md text-ui",
            scheduledActive
              ? "app-selected-surface text-fg"
              : "text-fg-subtle hover:bg-[var(--control-bg-hover)] hover:text-fg",
          )}
          data-sidebar-depth="0"
          data-sidebar-trailing-track="single"
        >
          <SidebarGridCell slot="icon">
            <span className="sidebar-row-icon">
              <CalendarClockIcon className="size-3.5" />
            </span>
          </SidebarGridCell>
          <SidebarGridCell slot="label">
            <span className={cn("min-w-0 truncate", labelCls)}>{t("sidebar.scheduled")}</span>
          </SidebarGridCell>
          <SidebarGridCell slot="trailing" aria-hidden="true" />
        </Link>
      </div>

      <nav className="sidebar-content-inset app-no-drag pt-5 pb-2">
        {openmaAccount?.user && openmaAccount.workspaces.map((workspace) => {
          const scope = openmaWorkspaceScope(openmaAccount, workspace.id);
          const rows = sessions.filter((row) => row.openma && sameOpenmaScope(row.openma, scope));
          return <TenantSidebarSection key={JSON.stringify(scope)} scope={scope} name={workspace.name || workspace.id}
            enabled={!workspace.expired && openmaAccount.status !== "signing_in"} labelCls={labelCls} rows={rows}
            renderRow={(s, depth) => <SessionRow row={s} depth={depth} agentIconUrl={agentIconUrls.get(s.agent_id)}
              active={s.id === activeId && location.pathname.startsWith("/chat/")} hasSchedule={false} labelCls={labelCls}
              onSelect={() => onSelectSession(s.id)} onRename={() => requestRename({ kind: "session", id: s.id, title: s.label })}
              onArchive={() => void requestArchive([s.id])} menuOpen={openMenuId === s.id} onMenuOpenChange={(open) => setOpenMenuId(open ? s.id : null)} />}
          />;
        })}
        <section className="sidebar-section">
          {/* The runtime switch is only a choice once OpenMA offers remote
              locations; local-only, it was a "本机" layer over everything. The
              composer keeps its own control. */}
          {openmaAccount?.user && <RuntimeLocationControl variant="sidebar" labelCls={labelCls} />}
          <div>
          {(() => {
            const { pinned, projects, chats } = grouped;
            return (
              <>
                {pinned.length > 0 && (
                  <SidebarSection
                    title={t("sidebar.pinned")}
                    headingSize="compact"
                    open={openSectionKeys.has("pinned")}
                    onToggle={() => toggleSection("pinned")}
                    labelCls={labelCls}
                    depth={0}
                  >
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {pinned.map((s) => (
                        <li key={s.id}>
                          <SessionRow
                            row={s}
                            {...sectionRowProps}
                            depth={0}
                            agentIconUrl={agentIconUrls.get(s.agent_id)}
                            active={s.id === activeId && location.pathname.startsWith("/chat/")}
                            hasSchedule={scheduledSessionIds.has(s.id)}
                            labelCls={labelCls}
                            onSelect={() => onSelectSession(s.id)}
                            onRename={() =>
                              requestRename({ kind: "session", id: s.id, title: s.label })
                            }
                            onArchive={() => void requestArchive([s.id])}
                            menuOpen={openMenuId === s.id}
                            onMenuOpenChange={(open) =>
                              setOpenMenuId(open ? s.id : null)
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </SidebarSection>
                )}
                {grouped.customSections.map((section) => {
                  const definition = customSections.find(item => item.id === section.id)!;
                  return <SidebarSection key={section.id} title={section.name}
                    headingSize="compact"
                    customSectionId={section.id}
                    depth={0}
                    open={!closedCustomSectionIds.has(section.id)}
                    onToggle={() => setClosedCustomSectionIds(current => {
                      const next = new Set(current);
                      if (next.has(section.id)) next.delete(section.id);
                      else next.add(section.id);
                      return next;
                    })}
                    labelCls={labelCls}
                    menuLabel={t("sidebar.sectionActions")}
                    menu={(kit) => <>
                      <kit.Item icon={<SquarePenIcon />} onSelect={() => openSectionDialog("rename", definition)}>{t("sidebar.renameSection")}</kit.Item>
                      <kit.Item icon={<Trash2Icon />} danger onSelect={() => setDeleteSectionId(section.id)}>{t("sidebar.deleteSection")}</kit.Item>
                    </>}
                  >
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {section.sessions.map((s) => <li key={s.id}>
                        <SessionRow row={s} {...sectionRowProps} currentSectionId={section.id}
                          depth={0}
                          agentIconUrl={agentIconUrls.get(s.agent_id)}
                          active={s.id === activeId && location.pathname.startsWith("/chat/")}
                          hasSchedule={scheduledSessionIds.has(s.id)} labelCls={labelCls}
                          onSelect={() => onSelectSession(s.id)}
                          onRename={() => requestRename({ kind: "session", id: s.id, title: s.label })}
                          onArchive={() => void requestArchive([s.id])}
                          menuOpen={openMenuId === s.id}
                          onMenuOpenChange={open => setOpenMenuId(open ? s.id : null)} />
                      </li>)}
                    </ul>
                  </SidebarSection>;
                })}
                {pairs.length > 0 && (
                  <SidebarSection
                    title={t("sidebar.pairs")}
                    headingSize="compact"
                    open={openSectionKeys.has("pairs")}
                    onToggle={() => toggleSection("pairs")}
                    labelCls={labelCls}
                    depth={0}
                  >
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {pairs.map((p) => (
                        <li key={p.id}>
                          <PairSidebarRow
                            row={p}
                            depth={0}
                            active={p.id === activePairId}
                            labelCls={labelCls}
                            onSelect={() => onSelectPair(p.id)}
                            onRename={() =>
                              requestRename({ kind: "pair", id: p.id, title: p.label })
                            }
                            menuOpen={openMenuId === `pair:${p.id}`}
                            onMenuOpenChange={(open) =>
                              setOpenMenuId(open ? `pair:${p.id}` : null)
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </SidebarSection>
                )}
                <SidebarSection
                  title={t("sidebar.projects")}
                  headingSize="compact"
                  menu={(kit) => <kit.Item icon={<PlusIcon />} onSelect={() => setCreateProjectOpen(true)}>{t("project.create")}</kit.Item>}
                  open={openSectionKeys.has("projects")}
                  onToggle={() => toggleSection("projects")}
                  labelCls={labelCls}
                  depth={0}
                  action={
                    <button
                      type="button"
                      onClick={() => setCreateProjectOpen(true)}
                      aria-label={t("project.create")}
                      title={t("project.create")}
                      data-sidebar-grid-action="last"
                      className="sidebar-row-action"
                    >
                      <PlusIcon aria-hidden="true" />
                    </button>
                  }
                >
                  {projects.length > 0 && (
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {projects.map((project) => {
                        const open = openProjectKeys.has(project.key);
                        const coordinator = project.projectId ? coordinatorsByProject.get(project.projectId) : undefined;
                        const hasCoordinator = !!coordinator?.hasCoordinator;
                        return (
                          <li key={project.key}>
                            <ProjectSidebarRow
                              group={project}
                              open={open}
                              labelCls={labelCls}
                              onToggle={() => toggleProject(project.key)}
                              onNewChat={() =>
                                onNewProjectChat(project)
                              }
                              hasCoordinator={hasCoordinator}
                              onSetupCoordinator={() => void onOpenProject(project)}
                              onArchiveChats={() => setProjectAction({ kind: "archive", project })}
                              onRemove={() => setProjectAction({ kind: "remove", project })}
                              menuOpen={openMenuId === `project:${project.key}`}
                              onMenuOpenChange={(openMenu) =>
                                setOpenMenuId(
                                  openMenu ? `project:${project.key}` : null,
                                )
                              }
                            />
                            <AnimatedCollapse
                              open={open}
                              lightweight={
                                project.sessions.length +
                                  project.workspaces.reduce((n, ws) => n + 1 + ws.sessions.length, 0) >
                                LIGHTWEIGHT_COLLAPSE_THRESHOLD
                              }
                            >
                              {/* One indent level under the project. Worktrees group
                                  their chats under a quiet collapsible label instead
                                  of a nested tree level with its own icon. */}
                              <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0">
                                {hasCoordinator && (
                                  <li>
                                    <ProjectCoordinatorRow
                                      group={project}
                                      active={location.pathname === `/projects/${project.projectId}`}
                                      agentId={coordinator?.coordinatorAgent}
                                      agentIconUrl={coordinator?.coordinatorAgent ? agentIconUrls.get(coordinator.coordinatorAgent) : undefined}
                                      agentLabel={agents.find(agent => agent.id === coordinator?.coordinatorAgent)?.label ?? coordinator?.coordinatorAgent}
                                      onOpen={() => void onOpenProject(project)}
                                      labelCls={labelCls}
                                    />
                                  </li>
                                )}
                                {!hasCoordinator && project.sessions.length === 0 && project.workspaces.length === 0 && (
                                  <li>
                                    <SidebarGridRow depth={1} leading="none" trailingTrack="none"
                                      role="status" className="text-caption text-fg-faint"
                                      data-sidebar-empty-project="true">
                                      <SidebarGridCell slot="label"><span>{t("sidebar.emptyWorkspace")}</span></SidebarGridCell>
                                    </SidebarGridRow>
                                  </li>
                                )}
                                {project.sessions.map((s) => (
                                  <li key={s.id}>{renderProjectSession(s)}</li>
                                ))}
                                {project.workspaces.map((ws) => {
                                  const wsKey = `${project.key}/${ws.id}`;
                                  // A worktree with chats starts open; an empty one starts
                                  // closed and only reveals its empty hint when asked.
                                  const wsEmpty = ws.sessions.length === 0;
                                  const wsToggleKey = wsEmpty ? `open:${wsKey}` : `closed:${wsKey}`;
                                  const wsOpen = openProjectKeys.has(wsToggleKey) === wsEmpty;
                                  return (
                                    <li key={ws.id}>
                                      <WorkspaceGroupHeading
                                        workspace={ws}
                                        open={wsOpen}
                                        labelCls={labelCls}
                                        onToggle={() =>
                                          setOpenProjectKeys((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(wsToggleKey)) next.delete(wsToggleKey);
                                            else next.add(wsToggleKey);
                                            return next;
                                          })
                                        }
                                        onNewChat={() => onNewProjectChat(project, ws.id)}
                                        onArchiveChats={() => void requestArchive(ws.sessions.map((s) => s.id))}
                                        onDelete={() => void onDeleteWorkspace(ws)}
                                        menuOpen={openMenuId === `workspace:${ws.id}`}
                                        onMenuOpenChange={(openMenu) =>
                                          setOpenMenuId(openMenu ? `workspace:${ws.id}` : null)
                                        }
                                      />
                                      <AnimatedCollapse
                                        open={wsOpen}
                                        lightweight={ws.sessions.length > LIGHTWEIGHT_COLLAPSE_THRESHOLD}
                                      >
                                        <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0">
                                          {wsEmpty && (
                                            <li>
                                              <SidebarGridRow depth={1} leading="none" trailingTrack="none"
                                                role="status" className="text-caption text-fg-faint">
                                                <SidebarGridCell slot="label"><span>{t("sidebar.emptyWorkspace")}</span></SidebarGridCell>
                                              </SidebarGridRow>
                                            </li>
                                          )}
                                          {ws.sessions.map((s) => (
                                            <li key={s.id}>{renderProjectSession(s)}</li>
                                          ))}
                                        </ul>
                                      </AnimatedCollapse>
                                    </li>
                                  );
                                })}
                              </ul>
                            </AnimatedCollapse>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </SidebarSection>
                <SidebarSection
                    title={t("sidebar.chats")}
                    headingSize="compact"
                    action={newConversationAction}
                    menu={(kit) => <>
                      <kit.Item icon={<SquarePenIcon />} onSelect={goHome}>{t("sidebar.newConversation")}</kit.Item>
                      <kit.Item icon={<PlusIcon />} onSelect={() => openSectionDialog("create")}>{t("sidebar.newSection")}</kit.Item>
                    </>}
                    open={openSectionKeys.has("chats")}
                    onToggle={() => toggleSection("chats")}
                    labelCls={labelCls}
                    depth={0}
                  >
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {chats.map((s) => (
                        <li key={s.id}>
                          <SessionRow
                            row={s}
                            {...sectionRowProps}
                            depth={0}
                            agentIconUrl={agentIconUrls.get(s.agent_id)}
                            active={s.id === activeId && location.pathname.startsWith("/chat/")}
                            hasSchedule={scheduledSessionIds.has(s.id)}
                            labelCls={labelCls}
                            onSelect={() => onSelectSession(s.id)}
                            onRename={() =>
                              requestRename({ kind: "session", id: s.id, title: s.label })
                            }
                            onArchive={() => void requestArchive([s.id])}
                            menuOpen={openMenuId === s.id}
                            onMenuOpenChange={(open) =>
                              setOpenMenuId(open ? s.id : null)
                            }
                          />
                        </li>
                      ))}
                    </ul>
                </SidebarSection>
              </>
            );
          })()}
          </div>
        </section>
      </nav>
      </ScrollArea>

      {/* Footer navigation and update affordance are independent hit targets.
          Opening the update popover never changes route or paints Settings as
          hovered; the fixed inset still matches the scrolling rows. */}
      <div
        className="sidebar-footer-chrome shrink-0 pb-1.5 pt-[var(--bottom-bar-gap-y)]"
        data-sidebar-footer-actions="true"
      >
        <SidebarGridRow trailingTrack="host"
          data-sidebar-row="settings"
          className={cn(settingsActive && "text-fg")}
        >
          <div
            className={cn(
              "sidebar-settings-primary",
              settingsActive && "app-selected-surface",
            )}
          >
            <SidebarGridCell slot="icon">
              <span className="sidebar-row-icon">
                <Settings2Icon className="size-3.5" />
              </span>
            </SidebarGridCell>
            <SidebarGridCell slot="label">
              <Link
                to="/settings/activity"
                aria-label={t("sidebar.settings")}
                className="app-no-drag flex h-full min-w-0 flex-1 items-center px-1.5 text-ui text-[inherit]"
              >
                <span className={cn("min-w-0 truncate", labelCls)}>{t("sidebar.settings")}</span>
              </Link>
            </SidebarGridCell>
          </div>
          <SidebarGridCell slot="trailing">
            <AgentUpdateControl agents={agents} />
          </SidebarGridCell>
        </SidebarGridRow>
      </div>
      <Dialog open={projectAction !== null} onOpenChange={open => { if (!open && !projectActionBusy) setProjectAction(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{projectAction?.kind === "remove"
            ? t("sidebar.removeProjectTitle", { name: projectAction.project.label })
            : t("sidebar.archiveProjectTitle", { count: String(projectChatIds.length) })}</DialogTitle></DialogHeader>
          <p className="text-sm text-fg-muted">{projectAction?.kind === "remove"
            ? t("sidebar.removeProjectBody")
            : t("sidebar.archiveProjectBody", { name: projectAction?.project.label ?? "" })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={projectActionBusy} onClick={() => setProjectAction(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" disabled={projectActionBusy || (projectAction?.kind === "archive" && projectChatIds.length === 0)} onClick={() => void confirmProjectAction()}>
              {projectActionBusy && <Loader2Icon className="size-4 animate-spin" />}
              {t(projectAction?.kind === "remove" ? "sidebar.removeProject" : "sidebar.archiveAll")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={sectionDialog !== null} onOpenChange={open => { if (!open) setSectionDialog(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t(sectionDialog?.kind === "rename" ? "sidebar.renameSection" : "sidebar.newSection")}</DialogTitle></DialogHeader>
          <input autoFocus aria-label={t("sidebar.sectionName")} value={sectionName}
            maxLength={80} onChange={event => setSectionName(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter") saveSection(); }}
            className="h-9 w-full rounded-lg bg-bg-surface/60 px-3 text-sm text-fg outline-none ring-ring focus-visible:ring-2" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSectionDialog(null)}>{t("common.cancel")}</Button>
            <Button disabled={!sectionName.trim() || customSections.some(section =>
              section.name.toLocaleLowerCase() === sectionName.trim().toLocaleLowerCase()
              && (sectionDialog?.kind === "create" || section.id !== sectionDialog?.id))}
              onClick={saveSection}>{t(sectionDialog?.kind === "rename" ? "common.save" : "sidebar.createSection")}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteSectionId !== null} onOpenChange={open => { if (!open) setDeleteSectionId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("sidebar.deleteSection")}</DialogTitle></DialogHeader>
          <p className="text-sm text-fg-muted">{t("sidebar.deleteSectionBody")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteSectionId(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => {
              setCustomSections(current => current.filter(section => section.id !== deleteSectionId));
              setDeleteSectionId(null);
            }}>{t("sidebar.deleteSection")}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onCreated={(project) => {
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          setOpenProjectKeys((current) =>
            new Set(current).add(`project:${project.id}`)
          );
          void navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
        }}
      />
      <RenameDialog
        open={renameTarget !== null}
        currentTitle={renameTarget?.title ?? ""}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onRename={submitRename}
      />
      <ArchiveScheduledChatDialog
        open={pendingArchive !== null}
        taskNames={pendingArchive?.taskNames ?? []}
        sessionCount={pendingArchive?.sessionIds.length ?? 0}
        onOpenChange={(open) => {
          if (!open) cancelArchive();
        }}
        onConfirm={confirmArchive}
      />
    </div>
  );
}

function TenantSidebarSection({ scope, name, enabled, labelCls, rows, renderRow }: {
  scope: OpenmaScope; name: string; enabled: boolean; labelCls: string; rows: SessionRowData[];
  renderRow: (row: SessionRowData, depth: SidebarGridDepth) => ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const tasks = useOpenmaTenantTasks(scope, enabled);
  const catalog = useOpenmaCatalog(scope, enabled && menuOpen);
  const choices = catalog.data ? openmaTargets(scope, catalog.data) : [];
  const pinned = rows.filter((row) => row.pinnedAt != null);
  const chats = rows.filter((row) => row.pinnedAt == null);
  const list = (items: SessionRowData[]) => <ul className="m-0 list-none space-y-0.5 p-0">{items.map((row) => <li key={row.id}>{renderRow(row, 0)}</li>)}</ul>;
  return <SidebarSection title={name} open={open} onToggle={() => setOpen(!open)} labelCls={labelCls} headingSize="compact">
      {enabled ? <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarGridRow as="button" type="button" depth={0}
            aria-label={t("sidebar.newTenantChat", { name })}
            className="rounded-md text-left text-ui text-fg-subtle hover:bg-[var(--control-bg-hover)] hover:text-fg">
            <SidebarGridCell slot="icon"><span className="sidebar-row-icon"><PlusIcon className="size-3.5" /></span></SidebarGridCell>
            <SidebarGridCell slot="label"><span className={labelCls}>{t("sidebar.newChat")}</span></SidebarGridCell>
          </SidebarGridRow>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="oma-scrollbar max-h-[60vh] w-72 overflow-y-auto">
          {choices.map(({ target, offline }) => <DropdownMenuItem key={`${target.environmentId}:${target.agentId}`} disabled={offline} onSelect={() => {
            const id = sessionStore.newDraft(); sessionStore.setExecutionTarget(id, target); void navigate({ to: "/" });
          }}>
            <div className="min-w-0 text-ui"><div className="truncate">{target.runtimeName} · {target.environmentName}</div><div className="text-fg-subtle">{target.agentName}{offline ? ` · ${t("openma.offline")}` : ""}</div></div>
          </DropdownMenuItem>)}
          {!choices.length && <div role="status" className="px-2 py-2 text-ui text-fg-muted">{t(catalog.isFetching ? "openma.loadingLocations" : catalog.error ? "openma.locationsUnavailable" : "openma.noLocations")}</div>}
          {catalog.error && <DropdownMenuItem onSelect={(event) => { event.preventDefault(); void catalog.refetch(); }}>{t("sidebar.retryTenant")}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu> : <SidebarGridRow as="button" type="button" depth={0} leading="none" trailingTrack="none"
        className="rounded-md text-left text-ui text-fg-subtle hover:bg-[var(--control-bg-hover)]"
        onClick={() => void navigate({ to: "/settings/openma" })}>
        <SidebarGridCell slot="label"><span>{t("openma.signIn")}</span></SidebarGridCell>
      </SidebarGridRow>}
      {pinned.length > 0 && <>
        <SidebarGridRow depth={0} leading="none" trailingTrack="none" className="text-ui text-fg-subtle">
          <SidebarGridCell slot="label"><span>{t("sidebar.pinned")}</span></SidebarGridCell>
        </SidebarGridRow>
        {list(pinned)}
      </>}
      {list(chats)}
      {enabled && tasks.error && <SidebarGridRow as="button" type="button" depth={0} leading="none" trailingTrack="none"
        className="text-left text-ui text-fg-subtle hover:bg-[var(--control-bg-hover)]"
        onClick={() => void tasks.refetch()}>
        <SidebarGridCell slot="label"><span>{t("sidebar.tenantLoadFailed")}</span></SidebarGridCell>
      </SidebarGridRow>}
      {enabled && !tasks.error && !rows.length && <SidebarGridRow depth={0} leading="none" trailingTrack="none"
        role="status" className="text-caption text-fg-subtle">
        <SidebarGridCell slot="label"><span>{t(tasks.isPending ? "sidebar.loadingTenant" : "sidebar.emptyTenant")}</span></SidebarGridCell>
      </SidebarGridRow>}
  </SidebarSection>;
}

function SidebarSection({
  title,
  open,
  onToggle,
  labelCls,
  children,
  action,
  icon,
  customSectionId,
  depth = 0,
  headingSize,
  menu,
  menuLabel,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  labelCls: string;
  children: ReactNode;
  action?: ReactNode;
  /** The heading's actions: right-click, and its ⋯ when there is no
   *  dedicated action button. Same menu either way. */
  menu?: RowMenu;
  menuLabel?: string;
  icon?: ReactNode;
  customSectionId?: string;
  depth?: SidebarGridDepth;
  headingSize?: "default" | "compact";
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const heading = (
    <SidebarSectionHeading
      title={title}
      open={open}
      onToggle={onToggle}
      labelCls={labelCls}
      action={action ?? (menu ? <RowMoreMenu menu={menu} open={menuOpen} onOpenChange={setMenuOpen} label={menuLabel ?? title} /> : undefined)}
      icon={icon}
      depth={depth}
      headingSize={headingSize}
      data-sidebar-row-hover="true"
      data-menu-open={menuOpen || undefined}
    />
  );
  return (
    <section className="sidebar-section" data-state={open ? "open" : "closed"} data-sidebar-custom-section={customSectionId}>
      {menu ? <RowContextMenu menu={menu}>{heading}</RowContextMenu> : heading}
      <AnimatedCollapse open={open}>
        <div>{children}</div>
      </AnimatedCollapse>
    </section>
  );
}

function ProjectSidebarRow({
  group,
  open,
  labelCls,
  onToggle,
  onNewChat,
  hasCoordinator,
  onSetupCoordinator,
  onArchiveChats,
  onRemove,
  menuOpen,
  onMenuOpenChange,
}: {
  group: SidebarProjectGroup;
  open: boolean;
  labelCls: string;
  onToggle: () => void;
  onNewChat: () => void;
  hasCoordinator: boolean;
  onSetupCoordinator: () => void;
  onArchiveChats: () => void;
  onRemove: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const menu: RowMenu = (kit) => <>
    <kit.Item icon={<SquarePenIcon />} onSelect={onNewChat}>{t("sidebar.startProjectChat")}</kit.Item>
    {group.projectId && <kit.Item icon={<Settings2Icon />} onSelect={() => void navigate({ to: "/settings/projects/$projectId", params: { projectId: group.projectId! } })}>
      {t("project.settings")}
    </kit.Item>}
    <kit.Item icon={<FolderOpenIcon />} disabled={!group.primaryRoot}
      onSelect={() => group.primaryRoot ? void window.backchat.uiFsOpenPath({ path: group.primaryRoot }) : undefined}>
      {t("sidebar.revealProject")}
    </kit.Item>
    {!hasCoordinator && <kit.Item icon={<WorkflowIcon />} onSelect={onSetupCoordinator}>{t("project.setupCoordinator")}</kit.Item>}
    <RepositoryMenuItems kit={kit} paths={[group.primaryRoot, ...group.sourceFolders]} />
    <kit.Separator />
    <kit.Item icon={<ArchiveIcon />} onSelect={onArchiveChats}>{t("sidebar.archiveProjectChats")}</kit.Item>
    <kit.Item icon={<Trash2Icon />} danger onSelect={onRemove}>{t("sidebar.removeProject")}</kit.Item>
  </>;
  return (
    <RowContextMenu menu={menu}>
      <SidebarGridRow
        depth={0}
        trailingTrack="double"
        className="app-no-drag sidebar-project-row sidebar-project-surface rounded-md text-left text-ui text-fg-subtle transition-colors"
        data-sidebar-project={group.key}
        data-sidebar-card={`project:${group.key}`}
        data-sidebar-row-hover="true"
        data-menu-open={menuOpen || undefined}
      >
        <SidebarGridCell slot="icon">
          <ProjectIcon identity={group.key} name={group.label} sourceFolders={group.sourceFolders} primaryRoot={group.primaryRoot} className="sidebar-row-icon" />
        </SidebarGridCell>
        <SidebarGridCell slot="label">
          <button
            type="button"
            onClick={onToggle}
            aria-label={`${open ? t("project.collapse") : t("project.expand")}: ${group.label}`}
            aria-expanded={open}
            className="flex h-full min-w-0 flex-1 items-center rounded-sm text-left text-ui focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className={cn("sidebar-project-label min-w-0 truncate", labelCls)}>{group.label}</span>
          </button>
        </SidebarGridCell>
        <SidebarGridCell slot="trailing" className={cn("sidebar-row-reveal", labelCls)}>
          <button
            type="button"
            aria-label={t("sidebar.startProjectChat")}
            title={t("sidebar.startProjectChat")}
            data-sidebar-grid-action="penultimate"
            onClick={onNewChat}
            className="sidebar-row-action"
          >
            <SquarePenIcon aria-hidden="true" />
          </button>
          <RowMoreMenu menu={menu} open={menuOpen} onOpenChange={onMenuOpenChange} label={t("sidebar.projectActions")} />
        </SidebarGridCell>
      </SidebarGridRow>
    </RowContextMenu>
  );
}

/** The project's configured coordinator, first under the project. An
 *  unconfigured project offers setup from its menu instead of a row. */
function ProjectCoordinatorRow({
  group,
  active,
  agentId,
  agentIconUrl,
  agentLabel,
  onOpen,
  labelCls,
}: {
  group: SidebarProjectGroup;
  active: boolean;
  agentId?: string;
  agentIconUrl?: string;
  agentLabel?: string;
  onOpen: () => void;
  labelCls: string;
}) {
  const { t } = useI18n();
  const label = t("project.coordinator");
  const rowClassName = cn(
    "sidebar-coordinator-row rounded-md",
    active && "app-selected-surface",
  );
  const rowProps = {
    "aria-label": `${t("project.openCoordinator")}: ${group.label}`,
    "aria-current": active ? "page" as const : undefined,
    "data-project-coordinator": group.key,
    "data-testid": "project-coordinator-row",
    "data-configured": true,
  };
  const content = <>
    <SidebarGridCell slot="icon">
      <span className="sidebar-coordinator-icon" title={agentLabel}>
        {agentId ? (
          <AgentIcon agentId={agentId} iconUrl={agentIconUrl} title={agentLabel} className="size-3.5" />
        ) : <WorkflowIcon aria-hidden="true" />}
      </span>
    </SidebarGridCell>
    <SidebarGridCell slot="label">
      <span className={cn("min-w-0 truncate", labelCls)}>{label}</span>
    </SidebarGridCell>
    <SidebarGridCell slot="trailing" className={labelCls} aria-hidden="true">
      <WorkflowIcon className="size-3.5 shrink-0" />
    </SidebarGridCell>
  </>;
  return group.projectId ? (
    <SidebarGridRow
      asChild
      depth={1}
      trailingTrack="single"
      className={rowClassName}
      {...rowProps}
    >
      <Link to="/projects/$projectId" params={{ projectId: group.projectId }}>
        {content}
      </Link>
    </SidebarGridRow>
  ) : (
    <SidebarGridRow
      as="button"
      type="button"
      onClick={onOpen}
      depth={1}
      trailingTrack="single"
      className={rowClassName}
      {...rowProps}
    >
      {content}
    </SidebarGridRow>
  );
}

/** A worktree inside a project: a quiet collapsible label (caption size,
 *  quaternary ink) over its chats. It sits at the project's depth with the
 *  caret in the project-icon column, so it groups without adding an indent
 *  level and the project tree stays two levels deep. */
function WorkspaceGroupHeading({
  workspace,
  open,
  labelCls,
  onToggle,
  onNewChat,
  onArchiveChats,
  onDelete,
  menuOpen,
  onMenuOpenChange,
}: {
  workspace: SidebarWorkspaceGroup;
  open: boolean;
  labelCls: string;
  onToggle: () => void;
  onNewChat: () => void;
  onArchiveChats: () => void;
  onDelete: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const revealPath = workspaceRevealPath(workspace);
  const label = workspaceMetaLabel(workspace);
  const menu: RowMenu = (kit) => <>
    <kit.Item icon={<SquarePenIcon />} onSelect={onNewChat}>{t("workspace.startChat")}</kit.Item>
    <kit.Item icon={<FolderOpenIcon />} disabled={!revealPath}
      onSelect={() => revealPath ? void window.backchat.uiFsOpenPath({ path: revealPath }) : undefined}>
      {t("workspace.reveal")}
    </kit.Item>
    <RepositoryMenuItems kit={kit} paths={workspace.paths} />
    <kit.Separator />
    <kit.Item icon={<ArchiveIcon />} disabled={workspace.sessions.length === 0} onSelect={onArchiveChats}>
      {t("sidebar.archiveProjectChats")}
    </kit.Item>
    {workspace.kind !== "external" && <kit.Item icon={<Trash2Icon />} danger onSelect={onDelete}>{t("workspace.delete")}</kit.Item>}
  </>;
  return (
    <RowContextMenu menu={menu}>
      <SidebarGridRow
        depth={0}
        trailingTrack="double"
        className="sidebar-workspace-heading app-no-drag rounded-md transition-colors"
        data-sidebar-workspace={workspace.id}
        data-sidebar-card={`workspace:${workspace.id}`}
        data-sidebar-row-hover="true"
        data-workspace-kind={workspace.kind}
        data-menu-open={menuOpen || undefined}
      >
        {/* Outdented one step: the caret sits in the project-icon column and the
            label starts on the chats' icon rail, so the heading reads as a
            divider over its chats rather than as another chat beside them. */}
        <SidebarGridCell slot="icon">
          <span className="sidebar-row-icon">
            <DisclosureCaret open={open} />
          </span>
        </SidebarGridCell>
        <SidebarGridCell slot="label">
          <button
            type="button"
            onClick={onToggle}
            aria-label={`${t("workspace.picker")}: ${workspace.label}`}
            aria-expanded={open}
            className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
          >
            {/* Identity cue: the same branch glyph the composer's workspace
                control uses, at caption size inline with the name, so the
                label reads as "workspace fix-abc" and not as another chat. */}
            <GitBranchIcon aria-hidden="true" className={cn("sidebar-workspace-glyph", labelCls)} />
            <span className={cn("min-w-0 truncate", labelCls)}>{label}</span>
          </button>
        </SidebarGridCell>
        <SidebarGridCell slot="trailing" className={cn("sidebar-row-reveal", labelCls)}>
          <button
            type="button"
            aria-label={t("workspace.startChat")}
            title={t("workspace.startChat")}
            data-sidebar-grid-action="penultimate"
            onClick={onNewChat}
            className="sidebar-row-action"
          >
            <SquarePenIcon aria-hidden="true" />
          </button>
          <RowMoreMenu menu={menu} open={menuOpen} onOpenChange={onMenuOpenChange} label={t("workspace.actions")} />
        </SidebarGridCell>
      </SidebarGridRow>
    </RowContextMenu>
  );
}

function PairSidebarRow({
  row,
  active,
  labelCls,
  depth = 0,
  onSelect,
  onRename,
  menuOpen,
  onMenuOpenChange,
}: {
  row: PairRow;
  active: boolean;
  labelCls: string;
  depth?: SidebarGridDepth;
  onSelect: () => void;
  onRename: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const menu: RowMenu = (kit) => <>
    <kit.Item icon={<SquarePenIcon />} onSelect={onRename}>{t("sidebar.rename")}</kit.Item>
    <kit.Separator />
    <kit.Item icon={row.pinnedAt != null ? <PinOffIcon /> : <PinIcon />}
      onSelect={() => row.pinnedAt != null ? sessionStore.unpinPair(row.id) : sessionStore.pinPair(row.id)}>
      {row.pinnedAt != null ? t("sidebar.unpin") : t("sidebar.pin")}
    </kit.Item>
    <kit.Separator />
    <kit.Item icon={<ArchiveIcon />} onSelect={() => sessionStore.archivePair(row.id)}>{t("sidebar.archive")}</kit.Item>
  </>;
  return (
    <RowContextMenu menu={menu}>
      <SidebarGridRow
        depth={depth}
        trailingTrack="double"
        className={cn(
          "app-no-drag rounded-md text-left text-ui transition-colors",
          active ? "app-selected-surface text-fg" : "text-fg-subtle",
        )}
        data-sidebar-card={`pair:${row.id}`}
        data-sidebar-row-hover="true"
        data-menu-open={menuOpen || undefined}
      >
        <SidebarGridCell slot="icon">
          <span className="sidebar-row-icon">
            <UsersRoundIcon />
          </span>
        </SidebarGridCell>
        <SidebarGridCell slot="label">
          <button
            type="button"
            onClick={onSelect}
            aria-label={row.label || t("sidebar.pairChat")}
            className="flex h-full min-w-0 flex-1 items-center rounded-sm text-left text-ui focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className={cn("min-w-0 truncate", labelCls)}>
              {row.label || t("sidebar.pairChat")}
            </span>
          </button>
        </SidebarGridCell>
        <SidebarGridCell slot="trailing" className={cn("sidebar-row-reveal", labelCls)}>
          {row.activeTurnId ? (
            <span className="sidebar-row-action pointer-events-none" aria-hidden="true" data-sidebar-grid-action="penultimate">
              <Loader2Icon className="animate-spin" />
            </span>
          ) : null}
          <RowMoreMenu menu={menu} open={menuOpen} onOpenChange={onMenuOpenChange} label={t("sidebar.sessionActions")} />
        </SidebarGridCell>
      </SidebarGridRow>
    </RowContextMenu>
  );
}

/** Session row — plain button, no Radix trickery. The `…` icon is a
 *  SEPARATE button inside the row that owns its own DropdownMenu
 *  state via a controlled `open` prop. This sidesteps every issue
 *  we hit trying to wrap the row in a DropdownMenuTrigger (Radix
 *  wants one child, right-click wiring fights the row click,
 *  controlled-vs-uncontrolled state bugs). Trades: clicking `…`
 *  doesn't also navigate (stopPropagation on the button), and the
 *  menu opens via a pure onClick handler. */
export function SessionRow({
  row,
  agentIconUrl,
  active,
  hasSchedule = false,
  labelCls,
  depth = 0,
  onSelect,
  onRename,
  onArchive,
  menuOpen,
  onMenuOpenChange,
  sections = [],
  currentSectionId,
  onMoveToSection,
}: {
  row: SessionRowData;
  agentIconUrl?: string;
  active: boolean;
  hasSchedule?: boolean;
  labelCls: string;
  depth?: SidebarGridDepth;
  onSelect: () => void;
  onRename: () => void;
  onArchive: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  sections?: readonly SidebarCustomSection[];
  currentSectionId?: string;
  onMoveToSection?: (sessionId: string, sectionId: string | null) => void;
}) {
  const { t } = useI18n();
  const running = row.status === "running" || row.status === "starting";
  const errored = row.status === "errored";
  const pinned = row.pinnedAt != null;
  const workingDirectory = row.chosenCwd || row.cwd;
  const copy = (value: string, done: string) => {
    navigator.clipboard.writeText(value).then(
      () => toast.success(done),
      () => toast.error(t("sidebar.copyFailed")),
    );
  };
  const menu: RowMenu = (kit) => <>
    <kit.Item icon={<SquarePenIcon />} onSelect={onRename}>{t("sidebar.rename")}</kit.Item>
    <kit.Separator />
    <kit.Item icon={pinned ? <PinOffIcon /> : <PinIcon />}
      onSelect={() => { void (pinned ? sessionStore.unpin(row.id) : sessionStore.pin(row.id)).catch((error) => toast.error(String(error))); }}>
      {pinned ? t("sidebar.unpin") : t("sidebar.pin")}
    </kit.Item>
    {sections.length > 0 && onMoveToSection && <kit.Sub label={t("sidebar.moveToSection")}>
      {sections.map((section) => <kit.Item key={section.id} disabled={section.id === currentSectionId}
        onSelect={() => onMoveToSection(row.id, section.id)}>{section.name}</kit.Item>)}
      {currentSectionId && <><kit.Separator /><kit.Item onSelect={() => onMoveToSection(row.id, null)}>{t("sidebar.removeFromSection")}</kit.Item></>}
    </kit.Sub>}
    <kit.Sub icon={<CopyIcon />} label={t("sidebar.copy")}>
      {workingDirectory && <kit.Item onSelect={() => copy(workingDirectory, t("sidebar.workingDirectoryCopied"))}>
        {t("sidebar.copyWorkingDirectory")}
      </kit.Item>}
      <kit.Item onSelect={() => copy(row.id, t("sidebar.sessionIdCopied"))}>{t("sidebar.copySessionId")}</kit.Item>
    </kit.Sub>
    <kit.Separator />
    <kit.Item icon={<ArchiveIcon />} onSelect={onArchive}>{t("sidebar.archive")}</kit.Item>
  </>;

  return (
    <RowContextMenu menu={menu}>
      <SidebarGridRow
        depth={depth}
        trailingTrack={hasSchedule && !running ? "double" : "single"}
        className={sidebarNavRowClass({
          active,
          errored,
          className: "relative",
        })}
        data-session-id={row.id}
        data-sidebar-card={`session:${row.id}`}
        data-sidebar-row-hover="true"
        data-menu-open={menuOpen || undefined}
      >
        <SidebarGridCell slot="icon">
          <span className="sidebar-row-icon">
            {row.agent_id ? (
              <AgentIcon agentId={row.agent_id} iconUrl={agentIconUrl} className="size-3.5" title={row.agent_id} />
            ) : null}
          </span>
        </SidebarGridCell>
        <SidebarGridCell slot="label">
          {/* No native title: the sidebar hover card shows the full title,
              where it runs and any error, on the same timing as every row. */}
          <button
            type="button"
            onClick={onSelect}
            aria-label={row.label}
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-ui focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className={cn("min-w-0 truncate text-left", labelCls)}>{row.label}</span>
            {row.externalClient ? <ExternalSourceBadge client={row.externalClient} /> : null}
          </button>
        </SidebarGridCell>
        <SidebarGridCell slot="trailing" className="relative">
          {/* Resting indicators give way to ⋯ on hover, focus or an open menu. */}
          {running ? (
            <span
              className="sidebar-row-action sidebar-row-rest pointer-events-none"
              data-sidebar-grid-action="last"
              aria-hidden="true"
            >
              <Loader2Icon className="animate-spin" />
            </span>
          ) : (
            <>
              {hasSchedule && (
                <span
                  data-sidebar-schedule-indicator="true"
                  data-sidebar-grid-action="penultimate"
                  aria-hidden="true"
                  className="sidebar-row-action sidebar-row-rest pointer-events-none"
                >
                  <CalendarClockIcon />
                </span>
              )}
              {!hasSchedule && !active && row.unread ? (
                <span
                  data-sidebar-unread-indicator="true"
                  data-sidebar-grid-action="last"
                  aria-hidden="true"
                  className="sidebar-row-rest size-1.5 justify-self-center rounded-full pointer-events-none"
                  style={{ backgroundColor: "var(--unread-indicator)" }}
                />
              ) : null}
            </>
          )}
          <RowMoreMenu menu={menu} open={menuOpen} onOpenChange={onMenuOpenChange}
            label={t("sidebar.sessionActions")} className="sidebar-row-reveal" />
        </SidebarGridCell>
      </SidebarGridRow>
    </RowContextMenu>
  );
}
