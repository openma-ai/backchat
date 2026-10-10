import { useProjects } from "@/lib/projects-query";
import { ProjectIcon } from "@/components/ProjectIcon";
import { ChevronRightIcon as ChevronRightIcon, MoreIcon as MoreHorizontalIcon, ChatIcon as MessageSquareIcon, ChatsIcon as MessagesSquareIcon, PinIcon as PinIcon, PinOffIcon as PinOffIcon, SearchIcon as SearchIcon, SettingsIcon as Settings2Icon, ComposeIcon as SquarePenIcon, ArchiveIcon as ArchiveIcon, ScheduleIcon as CalendarClockIcon, FolderClosedIcon as FolderIcon, FolderOpenIcon as FolderOpenIcon, BranchIcon as GitBranchIcon, PlusIcon as PlusIcon, TrashIcon as Trash2Icon, ParticipantsIcon as UsersRoundIcon, CoordinationIcon as WorkflowIcon } from "@/components/BackchatIcons";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu } from "radix-ui";
import { toast } from "sonner";
import {
  Loader2Icon,
} from "@/components/Icons";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings-store";
import {
  selectActiveId,
  selectPairs,
  selectSessions,
  sessionStore,
  useSessionStore,
  type PairRow,
  type SessionRow,
} from "@/lib/session-store";
import { AgentIcon } from "@/components/AgentIcon";
import { ExternalSourceBadge } from "@/components/shell/ExternalSourceBadge";
import { AnimatedCollapse } from "@/components/ui/animated-collapse";
import { GAP_ADJACENT_PX } from "@/components/ui/gap-adjacent";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSidebarCollapse } from "@/components/shell/AppShell";
import {
  SidebarGridCell,
  SidebarGridRow,
  type SidebarGridDepth,
} from "@/components/shell/SidebarGridRow";
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
import type { ProjectInfo } from "@shared/projects.js";
import { isLiveWorkspaceId, type WorkspaceInfo } from "@shared/workspaces";
import { WORKSPACES_QUERY_KEY } from "@/lib/workspace-query";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

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
  sessions: SessionRow[];
  /** Full record when the workspace is still known to the main process. */
  info?: WorkspaceInfo;
}

export interface SidebarProjectGroup {
  key: string;
  label: string;
  /** Chats in the live workspace (the project's own source folders). */
  sessions: SessionRow[];
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
  session: SessionRow,
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
  sessions: SessionRow[],
  savedProjects: readonly ProjectInfo[] = [],
  workspaces: readonly WorkspaceInfo[] = [],
  removedPaths: readonly string[] = [],
  coordinatorSessionIds: ReadonlySet<string> = new Set(),
  sections: readonly SidebarCustomSection[] = [],
): {
  pinned: SessionRow[];
  projects: SidebarProjectGroup[];
  chats: SessionRow[];
  customSections: Array<{ id: string; name: string; sessions: SessionRow[] }>;
} {
  const pinned: SessionRow[] = [];
  const chats: SessionRow[] = [];
  const customSections = sections.map(({ id, name }) => ({ id, name, sessions: [] as SessionRow[] }));
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
    if (coordinatorSessionIds.has(session.id)) continue;
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
  return {
    pinned,
    projects: [...projectMap.values()],
    chats,
    customSections,
  };
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
    staleTime: 60_000,
    refetchOnWindowFocus: true,
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
  const [customSections, setCustomSections] = useState(readCustomSections);
  const [closedCustomSectionIds, setClosedCustomSectionIds] = useState<Set<string>>(
    () => readDisclosureKeys("backchat:closed-custom-sidebar-sections:v1", []),
  );
  const [sectionDialog, setSectionDialog] = useState<{ kind: "create" } | { kind: "rename"; id: string } | null>(null);
  const [sectionName, setSectionName] = useState("");
  const [deleteSectionId, setDeleteSectionId] = useState<string | null>(null);
  useEffect(() => saveDisclosureKeys("backchat:sidebar-projects:v1", openProjectKeys), [openProjectKeys]);
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
  const [localOpen, setLocalOpen] = useState(() => readDisclosureKeys("backchat:sidebar-local:v1", ["local"]).has("local"));
  useEffect(() => saveDisclosureKeys("backchat:sidebar-local:v1", new Set(localOpen ? ["local"] : [])), [localOpen]);
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

  // Hide labels while collapsed; AppShell overflow-hidden clips during expand
  // so icons and labels appear together with the rail width animation.
  const labelCls = cn(collapsed && "hidden", "truncate");

  const newConversationAction = (
    <button
      type="button"
      aria-label={t("sidebar.newConversation")}
      title={t("sidebar.newConversation")}
      data-sidebar-grid-action="penultimate"
      className="sidebar-row-action app-no-drag"
      onClick={goHome}
    >
      <SquarePenIcon aria-hidden="true" />
    </button>
  );

  return (
    <div className="sidebar-navigation flex h-full min-h-0 flex-col">
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
        <SidebarGridRow trailingTrack="double" className="rounded-md">
          <SidebarGridCell slot="icon">
            <span className="sidebar-row-icon">
              <SquarePenIcon className="size-3.5" />
            </span>
          </SidebarGridCell>
          <SidebarGridCell slot="label">
            <button
              type="button"
              data-testid="new-chat-button"
              onClick={goHome}
              aria-label={t("sidebar.newChat")}
              aria-current={newChatActive ? "page" : undefined}
              className={cn(
                "app-no-drag flex h-full min-w-0 flex-1 items-center rounded-sm text-left text-ui text-fg",
                "hover:bg-[var(--control-bg-hover)] transition-colors",
              )}
            >
              <span className={cn("min-w-0 truncate", labelCls)}>{t("sidebar.newChat")}</span>
            </button>
          </SidebarGridCell>
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
            <DropdownMenu>
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
      <div className="sidebar-scroll-content">

        <Link
          to="/scheduled"
          aria-label={t("sidebar.scheduled")}
          className={cn(
            "app-no-drag sidebar-grid-row mt-0.5 rounded-md text-ui",
            scheduledActive
              ? "app-selected-surface text-fg"
              : "text-fg hover:bg-[var(--control-bg-hover)]",
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

        <nav className="app-no-drag pt-5 pb-2">
        {openmaAccount?.user && openmaAccount.workspaces.map((workspace) => {
          const scope = openmaWorkspaceScope(openmaAccount, workspace.id);
          const rows = sessions.filter((row) => row.openma && sameOpenmaScope(row.openma, scope));
          return <TenantSidebarSection key={JSON.stringify(scope)} scope={scope} name={workspace.name || workspace.id}
            enabled={!workspace.expired && openmaAccount.status !== "signing_in"} labelCls={labelCls} rows={rows}
            renderRow={(s) => <SessionRow row={s} agentIconUrl={agentIconUrls.get(s.agent_id)}
              active={s.id === activeId && location.pathname.startsWith("/chat/")} hasSchedule={false} labelCls={labelCls}
              onSelect={() => onSelectSession(s.id)} onRename={() => requestRename({ kind: "session", id: s.id, title: s.label })}
              onArchive={() => void requestArchive([s.id])} menuOpen={openMenuId === s.id} onMenuOpenChange={(open) => setOpenMenuId(open ? s.id : null)} />}
          />;
        })}
        <SidebarSection title={t("chat.local")} open={localOpen} onToggle={() => setLocalOpen(!localOpen)} labelCls={labelCls}>
        <div>
          {(() => {
            const { pinned, projects, chats } = grouped;
            return (
              <>
                {pinned.length > 0 && (
                  <SidebarSection
                    title={t("sidebar.pinned")}
                    icon={<PinIcon className="size-3.5" />}
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
                            depth={1}
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
                    action={<DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" aria-label={t("sidebar.sectionActions")} className="sidebar-row-action">
                          <MoreHorizontalIcon aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        <DropdownMenuItem onSelect={() => openSectionDialog("rename", definition)}>{t("sidebar.renameSection")}</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDeleteSectionId(section.id)}>{t("sidebar.deleteSection")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>}
                  >
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {section.sessions.map((s) => <li key={s.id}>
                        <SessionRow row={s} {...sectionRowProps} currentSectionId={section.id}
                          depth={1}
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
                    icon={<MessagesSquareIcon className="size-3.5" />}
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
                            depth={1}
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
                    icon={openSectionKeys.has("projects") ? <FolderOpenIcon className="size-3.5" /> : <FolderIcon className="size-3.5" />}
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
                              onArchiveChats={() => setProjectAction({ kind: "archive", project })}
                              onRemove={() => setProjectAction({ kind: "remove", project })}
                              menuOpen={openMenuId === `project:${project.key}`}
                              onMenuOpenChange={(openMenu) =>
                                setOpenMenuId(
                                  openMenu ? `project:${project.key}` : null,
                                )
                              }
                            />
                            <AnimatedCollapse open={open}>
                              <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0">
                                <li>
                                  <ProjectCoordinatorRow
                                    group={project}
                                    active={location.pathname === `/projects/${project.projectId}`}
                                    hasCoordinator={!!coordinator?.hasCoordinator}
                                    agentId={coordinator?.coordinatorAgent}
                                    agentIconUrl={coordinator?.coordinatorAgent ? agentIconUrls.get(coordinator.coordinatorAgent) : undefined}
                                    agentLabel={agents.find(agent => agent.id === coordinator?.coordinatorAgent)?.label ?? coordinator?.coordinatorAgent}
                                    onOpen={() => void onOpenProject(project)}
                                    labelCls={labelCls}
                                  />
                                </li>
                                {project.sessions.map((s) => (
                                  <li key={s.id}>
                                    <SessionRow
                                      row={s}
                                      {...sectionRowProps}
                                      depth={1}
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
                                      onMenuOpenChange={(openMenu) =>
                                        setOpenMenuId(openMenu ? s.id : null)
                                      }
                                    />
                                  </li>
                                ))}
                                {project.workspaces.map((ws) => {
                                  const wsKey = `${project.key}/${ws.id}`;
                                  const wsOpen = !openProjectKeys.has(`closed:${wsKey}`);
                                  return (
                                    <li key={ws.id}>
                                      <WorkspaceSidebarRow
                                        workspace={ws}
                                        open={wsOpen}
                                        labelCls={labelCls}
                                        onToggle={() =>
                                          setOpenProjectKeys((prev) => {
                                            const next = new Set(prev);
                                            const k = `closed:${wsKey}`;
                                            if (next.has(k)) next.delete(k);
                                            else next.add(k);
                                            return next;
                                          })
                                        }
                                        onNewChat={() =>
                                          onNewProjectChat(project, ws.id)
                                        }
                                        onArchiveChats={() =>
                                          void requestArchive(ws.sessions.map((s) => s.id))
                                        }
                                        onDelete={() => void onDeleteWorkspace(ws)}
                                        menuOpen={openMenuId === `workspace:${ws.id}`}
                                        onMenuOpenChange={(openMenu) =>
                                          setOpenMenuId(openMenu ? `workspace:${ws.id}` : null)
                                        }
                                      />
                                      <AnimatedCollapse open={wsOpen}>
                                        <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0">
                                          {ws.sessions.map((s) => (
                                            <li key={s.id}>
                                              <SessionRow
                                                row={s}
                                                {...sectionRowProps}
                                                depth={2}
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
                                                onMenuOpenChange={(openMenu) =>
                                                  setOpenMenuId(openMenu ? s.id : null)
                                                }
                                              />
                                            </li>
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
                    icon={<MessageSquareIcon className="size-3.5" />}
                    action={newConversationAction}
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
                            depth={1}
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
        </SidebarSection>
        </nav>
      </div>
      </ScrollArea>

      {/* Footer navigation and update affordance are independent hit targets.
          Opening the update popover never changes route or paints Settings as
          hovered; the fixed inset still matches the scrolling rows. */}
      <div
        className="sidebar-footer-chrome shrink-0 pb-2 pt-[var(--bottom-bar-gap-y)]"
        data-sidebar-footer-actions="true"
      >
        <SidebarGridRow trailingTrack="host" className="rounded-md">
          <SidebarGridCell slot="icon">
            <span className="sidebar-row-icon">
              <Settings2Icon className="size-3.5" />
            </span>
          </SidebarGridCell>
          <SidebarGridCell slot="label">
            <Link
              to="/settings/activity"
              aria-label={t("sidebar.settings")}
              className={cn(
                "app-no-drag flex h-full min-w-0 flex-1 items-center rounded-sm text-ui transition-colors",
                settingsActive
                  ? "app-selected-surface text-fg"
                  : "text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg",
              )}
            >
              <span className={cn("min-w-0 truncate", labelCls)}>{t("sidebar.settings")}</span>
            </Link>
          </SidebarGridCell>
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
  scope: OpenmaScope; name: string; enabled: boolean; labelCls: string; rows: SessionRow[];
  renderRow: (row: SessionRow) => ReactNode;
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
  const list = (items: SessionRow[]) => <ul className="m-0 list-none space-y-0.5 p-0">{items.map((row) => <li key={row.id}>{renderRow(row)}</li>)}</ul>;
  return <SidebarSection title={name} open={open} onToggle={() => setOpen(!open)} labelCls={labelCls}>
    <div className="pl-2">
      {enabled ? <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t("sidebar.newTenantChat", { name })} className="flex h-[var(--sidebar-row-h)] w-full items-center gap-2 rounded-md px-2 text-left text-ui text-fg-muted hover:bg-surface-hover hover:text-fg">
            <PlusIcon className="size-3.5" /><span className={labelCls}>{t("sidebar.newChat")}</span>
          </button>
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
      </DropdownMenu> : <button type="button" className="px-2 py-2 text-ui text-fg-muted" onClick={() => void navigate({ to: "/settings/openma" })}>{t("openma.signIn")}</button>}
      {pinned.length > 0 && <><div className="px-2 py-1 text-ui text-fg-subtle">{t("sidebar.pinned")}</div>{list(pinned)}</>}
      {list(chats)}
      {enabled && tasks.error && <button type="button" onClick={() => void tasks.refetch()} className="px-2 py-2 text-left text-ui text-fg-muted">{t("sidebar.tenantLoadFailed")}</button>}
      {enabled && !tasks.error && !rows.length && <p role="status" className="m-0 px-2 py-2 text-caption text-fg-subtle">{t(tasks.isPending ? "sidebar.loadingTenant" : "sidebar.emptyTenant")}</p>}
    </div>
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
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  labelCls: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  customSectionId?: string;
  depth?: SidebarGridDepth;
}) {
  return (
    <section className="sidebar-section" data-state={open ? "open" : "closed"} data-sidebar-custom-section={customSectionId}>
      <SidebarGridRow
        depth={depth}
        trailingTrack="double"
        className="sidebar-section-header group/section rounded-md transition-colors hover:bg-[var(--control-bg-hover)] focus-within:bg-[var(--control-bg-hover)]"
      >
        <SidebarGridCell slot="icon">
          {icon ? <span className="sidebar-row-icon">{icon}</span> : null}
        </SidebarGridCell>
        <SidebarGridCell slot="label">
          <button
            type="button"
            onClick={onToggle}
            aria-label={title}
            aria-expanded={open}
            className={cn(
              "app-no-drag flex h-full min-w-0 flex-1 items-center gap-1 text-left",
              "text-ui font-normal text-fg-subtle",
              "hover:text-fg-muted",
              "transition-colors duration-[var(--dur-quick)] ease-[var(--ease-snap)]",
            )}
          >
            <span className={cn("min-w-0 truncate", labelCls)}>{title}</span>
            <span className={cn("inline-flex shrink-0", labelCls)}>
              <ChevronRightIcon
                aria-hidden="true"
                className={cn(
                  "size-3 transition-transform duration-[var(--motion-disclosure-duration)] ease-[var(--motion-disclosure-easing)]",
                  open && "rotate-90",
                  open &&
                    "opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100",
                )}
              />
            </span>
          </button>
        </SidebarGridCell>
        <SidebarGridCell
          slot="trailing"
          className={cn(
            labelCls.split(/\s+/).includes("hidden") && "hidden",
            action &&
              "opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100",
          )}
          data-sidebar-section-header-action={action ? "true" : undefined}
        >
          {action}
        </SidebarGridCell>
      </SidebarGridRow>
      <AnimatedCollapse open={open}>{children}</AnimatedCollapse>
    </section>
  );
}

function ProjectSidebarRow({
  group,
  open,
  labelCls,
  onToggle,
  onNewChat,
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
  onArchiveChats: () => void;
  onRemove: () => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <SidebarGridRow
      depth={2}
      trailingTrack="double"
      className="app-no-drag sidebar-project-row sidebar-project-surface group rounded-md text-left text-ui text-fg-muted transition-colors"
      data-sidebar-project={group.key}
      data-menu-open={menuOpen || undefined}
    >
      <SidebarGridCell slot="icon">
        <ProjectIcon identity={group.key} sourceFolders={group.sourceFolders} primaryRoot={group.primaryRoot} className="sidebar-row-icon" />
      </SidebarGridCell>
      <SidebarGridCell slot="label">
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${open ? t("project.collapse") : t("project.expand")}: ${group.label}`}
          aria-expanded={open}
          title={group.primaryRoot || group.label}
          className="flex h-full min-w-0 flex-1 items-center rounded-sm text-left text-ui focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className={cn("min-w-0 truncate", labelCls)}>{group.label}</span>
        </button>
      </SidebarGridCell>
      <SidebarGridCell
        slot="trailing"
        className={cn(
          "transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-snap)]",
          labelCls,
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
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
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("sidebar.projectActions")}
              data-sidebar-row-action="true"
              data-sidebar-grid-action="last"
              className="sidebar-row-action"
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={GAP_ADJACENT_PX}
            className="w-fit min-w-[160px]"
          >
            {group.projectId && <DropdownMenuItem onSelect={() => void navigate({ to: "/settings/projects/$projectId", params: { projectId: group.projectId! } })} className="flex items-center gap-2 py-1 text-ui">
              <Settings2Icon className="size-3.5" /><span>{t("project.settings")}</span>
            </DropdownMenuItem>}
            <DropdownMenuItem
              onSelect={() =>
                group.primaryRoot
                  ? void window.backchat.uiFsOpenPath({ path: group.primaryRoot })
                  : undefined
              }
              disabled={!group.primaryRoot}
              className="flex items-center gap-2 py-1 text-ui"
            >
              <FolderOpenIcon className="size-3.5" />
              <span>{t("sidebar.revealProject")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 h-px bg-border/60" />
            <DropdownMenuItem
              onSelect={onArchiveChats}
              className="flex items-center gap-2 py-1 text-ui"
            >
              <ArchiveIcon className="size-3.5" />
              <span>{t("sidebar.archiveProjectChats")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove} className="flex items-center gap-2 py-1 text-ui text-danger">
              <Trash2Icon className="size-3.5" /><span>{t("sidebar.removeProject")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarGridCell>
    </SidebarGridRow>
  );
}

function ProjectCoordinatorRow({
  group,
  active,
  hasCoordinator,
  agentId,
  agentIconUrl,
  agentLabel,
  onOpen,
  labelCls,
}: {
  group: SidebarProjectGroup;
  active: boolean;
  hasCoordinator: boolean;
  agentId?: string;
  agentIconUrl?: string;
  agentLabel?: string;
  onOpen: () => void;
  labelCls: string;
}) {
  const { t } = useI18n();
  const label = t(hasCoordinator ? "project.coordinator" : "project.setupCoordinator");
  const rowClassName = cn(
    "sidebar-coordinator-row rounded-md",
    active && "app-selected-surface",
  );
  const props = {
    "aria-label": `${t(hasCoordinator ? "project.openCoordinator" : "project.setupCoordinator")}: ${group.label}`,
    "aria-current": active ? "page" as const : undefined,
    "data-project-coordinator": group.key,
    "data-testid": "project-coordinator-row",
    "data-configured": hasCoordinator,
    className: cn("sidebar-grid-row", rowClassName),
    "data-sidebar-depth": "2",
    "data-sidebar-trailing-track": "double",
  };
  const content = <>
    <SidebarGridCell slot="icon">
      <span className="sidebar-coordinator-icon" title={hasCoordinator ? agentLabel : undefined}>
        {hasCoordinator && agentId ? (
          <AgentIcon agentId={agentId} iconUrl={agentIconUrl} title={agentLabel} className="size-3.5" />
        ) : <PlusIcon aria-hidden="true" />}
      </span>
    </SidebarGridCell>
    <SidebarGridCell slot="label">
      <span className={cn("min-w-0 truncate font-medium", labelCls)}>{label}</span>
    </SidebarGridCell>
    <SidebarGridCell slot="trailing" className={cn(!hasCoordinator && "invisible", labelCls)} aria-hidden={!hasCoordinator}>
      <WorkflowIcon className="size-3.5 text-fg-muted" />
    </SidebarGridCell>
  </>;
  return group.projectId ? (
    <Link to="/projects/$projectId" params={{ projectId: group.projectId }} {...props}>{content}</Link>
  ) : (
    <button type="button" onClick={onOpen} {...props}>{content}</button>
  );
}

/** Workspace node. Hovering the label reveals the worktrees behind it —
 *  one per repository the project spans — so the user knows which
 *  checkouts a chat under this node actually edits. */
function WorkspaceSidebarRow({
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
  const worktrees = workspace.info?.worktrees ?? [];
  const primaryPath = workspace.paths[0];
  return (
    <SidebarGridRow
      depth={2}
      trailingTrack="double"
      className={cn(
        "app-no-drag group rounded-md text-left text-ui",
        "text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg active:bg-[var(--control-bg-open)]",
        "transition-colors",
      )}
      data-sidebar-workspace={workspace.id}
      data-workspace-kind={workspace.kind}
    >
      <SidebarGridCell slot="icon">
        <span className="sidebar-row-icon text-fg-muted group-hover:text-fg">
          <GitBranchIcon />
        </span>
      </SidebarGridCell>
      <SidebarGridCell slot="label">
        <HoverCard openDelay={350} closeDelay={80}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              onClick={onToggle}
              aria-label={workspace.label}
              aria-expanded={open}
              className="flex h-full min-w-0 flex-1 items-center rounded-sm text-left text-ui focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className={cn("min-w-0 truncate", labelCls)}>
                {workspace.label}
              </span>
            </button>
          </HoverCardTrigger>
          <HoverCardContent
            side="right"
            align="start"
            sideOffset={GAP_ADJACENT_PX}
            className="w-auto max-w-[360px] p-2 text-ui"
          >
            <div className="mb-1 flex items-center gap-2 text-fg">
              <GitBranchIcon className="shrink-0 size-3.5 text-fg-subtle" />
              <span className="truncate font-medium">{workspace.label}</span>
              <span className="ml-auto shrink-0 text-fg-subtle">
                {workspace.kind === "external" ? t("workspace.external") : t("workspace.managed")}
              </span>
            </div>
            <ul className="m-0 list-none space-y-0.5 p-0">
              {(worktrees.length > 0
                ? worktrees.map((w) => ({ path: w.path, name: folderName(w.repoRoot), branch: w.branch, head: w.head }))
                : workspace.paths.map((path) => ({ path, name: folderName(path), branch: null, head: "" }))
              ).map((w) => (
                <li key={w.path} className="flex items-center gap-2 text-fg-muted">
                  <FolderIcon className="size-3 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 truncate text-fg" title={w.path}>{w.name}</span>
                  <span className="shrink-0 text-fg-subtle">·</span>
                  <span className="min-w-0 flex-1 truncate text-fg-muted" title={w.branch ?? w.head}>
                    {w.branch ?? (w.head ? `${t("workspace.detached")} · ${w.head.slice(0, 7)}` : t("workspace.detached"))}
                  </span>
                </li>
              ))}
            </ul>
          </HoverCardContent>
        </HoverCard>
      </SidebarGridCell>
      <SidebarGridCell
        slot="trailing"
        className={cn(
          "transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-snap)]",
          labelCls,
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
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
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("workspace.actions")}
              data-sidebar-row-action="true"
              data-sidebar-grid-action="last"
              className="sidebar-row-action"
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={GAP_ADJACENT_PX} className="w-fit min-w-[180px]">
            <DropdownMenuItem
              onSelect={() =>
                primaryPath ? void window.backchat.uiFsOpenPath({ path: primaryPath }) : undefined
              }
              disabled={!primaryPath}
              className="flex items-center gap-2 py-1 text-ui"
            >
              <FolderOpenIcon className="size-3.5" />
              <span>{t("workspace.reveal")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 h-px bg-border/60" />
            <DropdownMenuItem
              onSelect={onArchiveChats}
              disabled={workspace.sessions.length === 0}
              className="flex items-center gap-2 py-1 text-ui"
            >
              <ArchiveIcon className="size-3.5" />
              <span>{t("sidebar.archiveProjectChats")}</span>
            </DropdownMenuItem>
            {workspace.kind !== "external" && (
              <DropdownMenuItem
                onSelect={onDelete}
                className="flex items-center gap-2 py-1 text-ui text-danger"
              >
                <Trash2Icon className="size-3.5" />
                <span>{t("workspace.delete")}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarGridCell>
    </SidebarGridRow>
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
  return (
    <SidebarGridRow
      depth={depth}
      trailingTrack="double"
      className={cn(
        "app-no-drag group rounded-md text-left text-ui",
        active
          ? "app-selected-surface text-fg"
          : "text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg",
        "transition-colors",
      )}
    >
      <SidebarGridCell slot="icon">
        <span className="sidebar-row-icon text-fg-muted group-hover:text-fg">
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
      <SidebarGridCell
        slot="trailing"
        className={cn(
          "transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-snap)]",
          labelCls,
          menuOpen
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {row.activeTurnId ? (
          <span className="sidebar-row-action pointer-events-none" aria-hidden="true" data-sidebar-grid-action="penultimate">
            <Loader2Icon className="animate-spin" />
          </span>
        ) : null}
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("sidebar.sessionActions")}
              onClick={(event) => event.stopPropagation()}
              data-sidebar-row-action="true"
              data-sidebar-grid-action="last"
              className="sidebar-row-action"
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={GAP_ADJACENT_PX} className="w-fit min-w-[140px]">
            <DropdownMenuItem
              onSelect={onRename}
              className="flex items-center gap-2 py-1 text-ui"
            >
              <SquarePenIcon className="size-3.5" />
              <span>{t("sidebar.rename")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 h-px bg-border/60" />
            <DropdownMenuItem
              onSelect={() =>
                row.pinnedAt != null
                  ? sessionStore.unpinPair(row.id)
                  : sessionStore.pinPair(row.id)
              }
              className="flex items-center gap-2 py-1 text-ui"
            >
              {row.pinnedAt != null ? (
                <PinOffIcon className="size-3.5" />
              ) : (
                <PinIcon className="size-3.5" />
              )}
              <span>
                {row.pinnedAt != null ? t("sidebar.unpin") : t("sidebar.pin")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 h-px bg-border/60" />
            <DropdownMenuItem
              onSelect={() => sessionStore.archivePair(row.id)}
              className="flex items-center gap-2 py-1 text-ui"
            >
              <ArchiveIcon className="size-3.5" />
              <span>{t("sidebar.archive")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarGridCell>
    </SidebarGridRow>
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
function SessionRow({
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
  row: SessionRow;
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
  const setMenuOpen = onMenuOpenChange;

  // The two menu surfaces (DropdownMenu for the `…` button, ContextMenu
  // for right-click) use different Radix React contexts — Item/
  // Separator from one don't render inside the other. Rather than
  // build an abstraction over both, inline the same item structure
  // twice. Less clever, more readable.

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <SidebarGridRow
          depth={depth}
          trailingTrack="double"
          className={cn(
            "group relative rounded-md text-ui",
            errored && "text-danger",
            active
              ? "app-selected-surface text-fg"
              : !errored && "text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg",
            "transition-colors",
          )}
        >
          <SidebarGridCell slot="icon">
            <span className="sidebar-row-icon text-fg-muted group-hover:text-fg">
              {row.agent_id ? (
                <AgentIcon agentId={row.agent_id} iconUrl={agentIconUrl} className="size-3.5" title={row.agent_id} />
              ) : null}
            </span>
          </SidebarGridCell>
          <SidebarGridCell slot="label">
            <button
              type="button"
              onClick={onSelect}
              title={row.lastError ?? row.label}
              aria-label={row.label}
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-ui focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className={cn("min-w-0 truncate text-left", labelCls)}>{row.label}</span>
              {row.externalClient ? <ExternalSourceBadge client={row.externalClient} /> : null}
            </button>
          </SidebarGridCell>
          <SidebarGridCell slot="trailing" className="relative">
            {running ? (
              <span
                className="sidebar-row-action pointer-events-none"
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
                    className={cn(
                      "sidebar-row-action pointer-events-none",
                      menuOpen
                        ? "opacity-0"
                        : "opacity-100 group-hover:opacity-0",
                    )}
                  >
                    <CalendarClockIcon />
                  </span>
                )}
                {!hasSchedule && !active && row.unread ? (
                  <span
                    className="size-1.5 justify-self-center rounded-full"
                    style={{ backgroundColor: "oklch(0.62 0.16 240)" }}
                  />
                ) : (
                  <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("sidebar.sessionActions")}
                        onClick={(e) => e.stopPropagation()}
                        data-sidebar-row-action="true"
                        data-sidebar-grid-action="last"
                        className={cn(
                          "sidebar-row-action transition-opacity",
                          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          hasSchedule && !menuOpen && "pointer-events-none group-hover:pointer-events-auto",
                        )}
                      >
                        <MoreHorizontalIcon aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={GAP_ADJACENT_PX} className="w-fit min-w-[140px]">
                      <DropdownMenuItem
                        onSelect={onRename}
                        className="flex items-center gap-2 py-1 text-ui"
                      >
                        <SquarePenIcon className="size-3.5" />
                        <span>{t("sidebar.rename")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="my-1 h-px bg-border/60" />
                      <DropdownMenuItem
                        onSelect={() => { void (pinned ? sessionStore.unpin(row.id) : sessionStore.pin(row.id)).catch((error) => toast.error(String(error))); }}
                        className="flex items-center gap-2 py-1 text-ui"
                      >
                        {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
                        <span>{pinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
                      </DropdownMenuItem>
                      {sections.length > 0 && onMoveToSection && <DropdownMenuSub>
                        <DropdownMenuSubTrigger>{t("sidebar.moveToSection")}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="min-w-36">
                          {sections.map(section => <DropdownMenuItem key={section.id} disabled={section.id === currentSectionId}
                            onSelect={() => onMoveToSection(row.id, section.id)}>{section.name}</DropdownMenuItem>)}
                          {currentSectionId && <><DropdownMenuSeparator /><DropdownMenuItem
                            onSelect={() => onMoveToSection(row.id, null)}>{t("sidebar.removeFromSection")}</DropdownMenuItem></>}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>}
                      <DropdownMenuSeparator className="my-1 h-px bg-border/60" />
                      <DropdownMenuItem
                        onSelect={onArchive}
                        className="flex items-center gap-2 py-1 text-ui"
                      >
                        <ArchiveIcon className="size-3.5" />
                        <span>{t("sidebar.archive")}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
          </SidebarGridCell>
        </SidebarGridRow>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 w-fit min-w-[140px] overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ContextMenu.Item
            onSelect={onRename}
            className="flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-ui outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <SquarePenIcon className="size-3.5" />
            <span>{t("sidebar.rename")}</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border/60" />
          <ContextMenu.Item
            onSelect={() => { void (pinned ? sessionStore.unpin(row.id) : sessionStore.pin(row.id)).catch((error) => toast.error(String(error))); }}
            className="flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-ui outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
            <span>{pinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
          </ContextMenu.Item>
          {sections.length > 0 && onMoveToSection && <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="flex cursor-default select-none items-center rounded-md px-1.5 py-1 text-ui outline-none data-[highlighted]:bg-accent">
              {t("sidebar.moveToSection")}
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal><ContextMenu.SubContent className="z-50 min-w-36 overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-md">
              {sections.map(section => <ContextMenu.Item key={section.id} disabled={section.id === currentSectionId}
                onSelect={() => onMoveToSection(row.id, section.id)}
                className="cursor-default rounded-md px-1.5 py-1 text-ui outline-none data-[highlighted]:bg-accent">{section.name}</ContextMenu.Item>)}
              {currentSectionId && <ContextMenu.Item onSelect={() => onMoveToSection(row.id, null)}
                className="cursor-default rounded-md px-1.5 py-1 text-ui outline-none data-[highlighted]:bg-accent">{t("sidebar.removeFromSection")}</ContextMenu.Item>}
            </ContextMenu.SubContent></ContextMenu.Portal>
          </ContextMenu.Sub>}
          <ContextMenu.Separator className="my-1 h-px bg-border/60" />
          <ContextMenu.Item
            onSelect={onArchive}
            className="flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-ui outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <ArchiveIcon className="size-3.5" />
            <span>{t("sidebar.archive")}</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
