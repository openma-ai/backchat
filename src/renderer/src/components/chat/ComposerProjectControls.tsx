import { ProjectIcon } from "@/components/ProjectIcon";
import { useProjects } from "@/lib/projects-query";
import { useRemovedProjectPaths } from "@/lib/removed-projects";
import { useEffect, useRef, useState } from "react";
import {
  CircleAlertIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  FolderOpenIcon,
  GitBranchIcon,
  PlusIcon,
  XIcon,
} from "@/components/Icons";
import { toast } from "sonner";
import type { ProjectInfo } from "@shared/projects";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLiveWorkspaceId, type WorkspaceInfo } from "@shared/workspaces";
import { WORKSPACES_QUERY_KEY } from "@/lib/workspace-query";
import {
  ComposerGroupedCommandPicker,
  GROUPED_COMMAND_PANEL_HEIGHT_PX,
} from "@/components/chat/ComposerGroupedCommandPicker";
import {
  GroupedCommandPickerIconSlot,
  GroupedCommandPickerLabelSlot,
} from "@/components/chat/GroupedCommandPickerSlots";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { selectRecentProjectPaths } from "@/lib/composer-project-paths";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { folderName } from "@/lib/project-path";
import { useSessionStore, selectActive } from "@/lib/session-store";
import { RuntimeLocationControl } from "./RuntimeLocationControl";

const LAST_PROJECT_KEY = "backchat:last-project-directory:v1";

const WORKSPACE_INTRO_SEEN_KEY = "backchat:workspace-intro-seen:v1";
let workspaceIntroShown = false;

export function ProjectChipRow({
  isDraft,
  activeCwd,
  onPickCwd,
  onSetCwd,
  onClearCwd,
  projectId,
  workspaceId,
  onSetWorkspace,
}: {
  isDraft: boolean;
  activeCwd: string;
  onPickCwd: () => Promise<string | null>;
  onSetCwd: (path: string) => void;
  onClearCwd: () => void;
  /** Named project the draft belongs to; enables the workspace picker. */
  projectId?: string;
  /** Selected workspace; undefined/live = source folders. */
  workspaceId?: string | null;
  onSetWorkspace?: (workspaceId: string | null) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const activeSession = useSessionStore(selectActive);
  const remoteTarget = activeSession?.executionTarget;
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectPickerValue, setProjectPickerValue] = useState("");
  const { data: persisted = [], isSuccess: recentsLoaded } = useQuery({
    queryKey: ["sessions-for-recent-cwds"],
    queryFn: () => window.backchat.sessionsList(50),
    staleTime: 30_000,
  });
  const { data: savedProjects = [], isSuccess: projectsLoaded } = useProjects();
  const removedPaths = useRemovedProjectPaths();
  const eligiblePersisted = persisted.filter(row => !removedPaths.includes(row.cwd ?? "") || savedProjects.some(project => project.source_folders.includes(row.cwd ?? "")));
  const recents = selectRecentProjectPaths(eligiblePersisted).filter(path => !savedProjects.some(project => project.source_folders.includes(path)));
  const selectedProject = savedProjects.find(project => project.id === projectId) ?? savedProjects.find(project => project.source_folders.includes(activeCwd));
  useEffect(() => {
    if (!isDraft || remoteTarget || !activeSession) return;
    if (activeCwd) {
      try { localStorage.setItem(LAST_PROJECT_KEY, activeCwd); } catch { /* Storage may be unavailable. */ }
      return;
    }
    if (activeSession.projectId || activeSession.projectSelectionExplicit) return;
    let previous: string | null = null;
    try { previous = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* Fall back to session history. */ }
    if (!recentsLoaded || !projectsLoaded) return;
    const candidates = selectRecentProjectPaths([...eligiblePersisted, ...savedProjects.map(project => ({ cwd: project.primary_folder }))], Infinity);
    const recent = previous && candidates.includes(previous) ? previous : candidates[0];
    if (previous && !candidates.includes(previous)) {
      try { localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* Storage may be unavailable. */ }
    }
    if (recent) onSetCwd(recent);
  }, [isDraft, remoteTarget, activeSession?.id, activeSession?.projectId,
    activeSession?.projectSelectionExplicit, activeCwd, recentsLoaded, projectsLoaded, persisted, savedProjects, removedPaths, onSetCwd]);


  const { data: branch } = useQuery({
    queryKey: ["git-branch", activeCwd],
    queryFn: () =>
      activeCwd
        ? window.backchat.uiFsGitBranch({ path: activeCwd })
        : Promise.resolve(null),
    enabled: !!activeCwd && !remoteTarget,
    staleTime: 10_000,
  });

  const cwdLabel = selectedProject?.name ?? (activeCwd ? folderName(activeCwd) : t("chat.chooseProject"));
  const noProjectCommandValue = `${t("chat.noProject")} no project`;

  return (
    <div
      className="composer-footer-row-inset mb-[var(--composer-footer-gap)] flex shrink-0 items-center gap-[var(--control-gap-compact)] text-xs text-fg-muted"
      style={{ height: "var(--row-h)" }}
      data-composer-footer-controls="true"
    >
      <RuntimeLocationControl />

      {remoteTarget ? <span className="truncate text-xs text-fg-muted">{remoteTarget.agentName}</span> : <Popover
        open={isDraft && projectPickerOpen}
        onOpenChange={(open) => {
          const nextOpen = isDraft && open;
          if (nextOpen) {
            setProjectPickerValue(activeCwd || noProjectCommandValue);
          }
          setProjectPickerOpen(nextOpen);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-composer-footer-control="project"
            disabled={!isDraft}
            className="app-compact-control min-w-0 bg-transparent"
            title={activeCwd || t("chat.chooseProjectFolder")}
          >
            <span data-control-icon>
              {selectedProject ? <ProjectIcon identity={`project:${selectedProject.id}`} sourceFolders={selectedProject.source_folders} primaryRoot={selectedProject.primary_folder} /> : <FolderOpenIcon />}
            </span>
            <span className="max-w-[200px] truncate">{cwdLabel}</span>
            {isDraft && <ChevronDownIcon data-control-chevron />}
          </Button>
        </PopoverTrigger>
        {isDraft && (
          <PopoverContent
            side="top"
            align="start"
            sideOffset={0}
            className="w-[var(--composer-menu-width)] max-w-[var(--radix-popover-content-available-width)] gap-0 overflow-hidden bg-transparent p-0 shadow-none ring-0"
          >
            <ComposerGroupedCommandPicker
              testId="composer-project-picker-panel"
              menuMode="project-picker"
              panelClassName={cn(
                "flex flex-col overflow-hidden",
                `h-[min(${GROUPED_COMMAND_PANEL_HEIGHT_PX}px,var(--radix-popover-content-available-height))]`,
                `min-h-[min(${GROUPED_COMMAND_PANEL_HEIGHT_PX}px,var(--radix-popover-content-available-height))]`,
                `max-h-[min(${GROUPED_COMMAND_PANEL_HEIGHT_PX}px,var(--radix-popover-content-available-height))]`,
              )}
              commandClassName="rounded-xl! bg-popover text-popover-foreground shadow-none ring-0"
              searchPlaceholder={t("chat.chooseProject")}
              emptyMessage={t("chat.noMatchingOptions")}
              initialHighlightValue={projectPickerValue || activeCwd || noProjectCommandValue}
              groups={[
                ...(savedProjects.length > 0
                  ? [
                      {
                        heading: t("sidebar.projects"),
                        items: savedProjects.map((project) => ({
                          id: project.id,
                          value: project.primary_folder,
                          keywords: [project.name, ...project.source_folders],
                          checked: selectedProject?.id === project.id,
                          title: project.primary_folder,
                          onSelect: () => {
                            onSetCwd(project.primary_folder);
                            setProjectPickerOpen(false);
                          },
                          children: (
                            <>
                              <GroupedCommandPickerIconSlot>
                                <ProjectIcon
                                  identity={`project:${project.id}`}
                                  sourceFolders={project.source_folders}
                                  primaryRoot={project.primary_folder}
                                />
                              </GroupedCommandPickerIconSlot>
                              <GroupedCommandPickerLabelSlot>
                                <span className="truncate">{project.name}</span>
                              </GroupedCommandPickerLabelSlot>
                            </>
                          ),
                        })),
                      },
                    ]
                  : []),
                ...(recents.length > 0
                  ? [
                      {
                        heading: t("chat.recentDirectories"),
                        items: recents.map((path) => ({
                          id: path,
                          value: path,
                          checked: path === activeCwd,
                          title: path,
                          onSelect: () => {
                            onSetCwd(path);
                            setProjectPickerOpen(false);
                          },
                          children: (
                            <>
                              <GroupedCommandPickerIconSlot>
                                <FolderOpenIcon />
                              </GroupedCommandPickerIconSlot>
                              <GroupedCommandPickerLabelSlot>
                                <span className="truncate">{folderName(path)}</span>
                              </GroupedCommandPickerLabelSlot>
                            </>
                          ),
                        })),
                      },
                    ]
                  : []),
                {
                  items: [
                    {
                      id: "browse",
                      value: `${t("common.browse")} browse`,
                      onSelect: () => {
                        setProjectPickerOpen(false);
                        void (async () => {
                          try {
                            const path = await onPickCwd();
                            if (!path) return;
                            const projects = await window.backchat.projectsList();
                            if (
                              !projects.some(
                                (project) => project.primary_folder === path,
                              )
                            ) {
                              const project = await window.backchat.projectSave({
                                project_id: `proj-${crypto.randomUUID()}`,
                                name: folderName(path),
                                source_folders: [path],
                                primary_folder: path,
                              });
                              projects.push(project);
                            }
                            queryClient.setQueryData<ProjectInfo[]>(
                              ["projects"],
                              projects,
                            );
                            onSetCwd(path);
                          } catch (error) {
                            toast.error(t("project.createFailed"), {
                              description:
                                error instanceof Error
                                  ? error.message
                                  : String(error),
                            });
                          }
                        })();
                      },
                      children: (
                        <>
                          <GroupedCommandPickerIconSlot>
                            <FolderOpenIcon />
                          </GroupedCommandPickerIconSlot>
                          <GroupedCommandPickerLabelSlot>
                            <span className="truncate">{t("common.browse")}</span>
                          </GroupedCommandPickerLabelSlot>
                        </>
                      ),
                    },
                    {
                      id: "no-project",
                      value: noProjectCommandValue,
                      checked: !activeCwd,
                      onSelect: () => {
                        onClearCwd();
                        setProjectPickerOpen(false);
                      },
                      children: (
                        <>
                          <GroupedCommandPickerIconSlot>
                            <XIcon />
                          </GroupedCommandPickerIconSlot>
                          <GroupedCommandPickerLabelSlot>
                            <span className="truncate">{t("chat.noProject")}</span>
                          </GroupedCommandPickerLabelSlot>
                        </>
                      ),
                    },
                  ],
                },
              ]}
            />
          </PopoverContent>
        )}
      </Popover>}

      {!remoteTarget && (projectId || activeCwd) && onSetWorkspace ? (
        <WorkspaceChip
          key={`${projectId ?? ""}:${activeCwd}`}
          isDraft={isDraft}
          projectId={projectId}
          sourceDirectory={activeCwd}
          workspaceId={workspaceId ?? null}
          liveBranch={branch ?? null}
          onSetWorkspace={onSetWorkspace}
        />
      ) : !remoteTarget && branch && (
        <span
          className="app-compact-control inline-flex"
          title={t("workspace.branchLabel", { branch })}
        >
          <span data-control-icon>
            <GitBranchIcon />
          </span>
          <span className="max-w-[160px] truncate">{branch}</span>
        </span>
      )}
    </div>
  );
}

/** Where a project draft will run: the live source folders (default) or a
 *  managed/external checkout set. Creating one here makes a real branch
 *  under Backchat's worktree root and selects it immediately. */
function WorkspaceChip({
  isDraft,
  projectId,
  sourceDirectory,
  workspaceId,
  liveBranch,
  onSetWorkspace,
}: {
  isDraft: boolean;
  projectId?: string;
  sourceDirectory: string;
  workspaceId: string | null;
  liveBranch: string | null;
  onSetWorkspace: (workspaceId: string | null) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [view, setView] = useState<"choose" | "create">("choose");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const explicitChoices = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const { data: workspaces = [], isPending, isFetching } = useQuery({
    queryKey: [...WORKSPACES_QUERY_KEY, projectId ?? null, sourceDirectory],
    queryFn: () => window.backchat.workspacesList({ project_id: projectId, source_directory: projectId ? undefined : sourceDirectory }),
    staleTime: 30_000,
  });
  const live = workspaces.find(ws => ws.kind === "live");
  const repositories = (live?.worktrees ?? []).map(repo => {
    const seen = new Set<string>();
    const checkouts = [repo, ...workspaces.flatMap(ws => ws.worktrees)]
      .filter(tree => tree.repoRoot === repo.repoRoot && !seen.has(tree.path) && !!seen.add(tree.path));
    return { ...repo, checkouts };
  });
  useEffect(() => {
    if (!isDraft || !repositories.length || workspaceIntroShown) return;
    try {
      if (localStorage.getItem(WORKSPACE_INTRO_SEEN_KEY)) return;
      localStorage.setItem(WORKSPACE_INTRO_SEEN_KEY, "1");
    } catch {
      // Still show once per renderer when storage is unavailable.
    }
    workspaceIntroShown = true;
    setOpen(true);
    setIntroOpen(true);
  }, [isDraft, repositories.length]);
  const saved = workspaces.filter(ws =>
    (ws.kind === "managed" || ws.kind === "linked")
    && ws.worktrees.length === repositories.length
    && repositories.every(repo => ws.worktrees.some(tree => tree.repoRoot === repo.repoRoot)),
  );
  const selected = workspaces.find(ws => ws.id === workspaceId && ws.kind !== "live");
  const label = selected?.name ?? t("workspace.local");

  const chooseCheckout = (repoRoot: string, path: string) => {
    explicitChoices.current.add(repoRoot);
    const branch = repositories.find(repo => repo.repoRoot === repoRoot)?.checkouts.find(tree => tree.path === path)?.branch;
    setChoices(current => {
      const next = { ...current, [repoRoot]: path };
      if (branch) {
        for (const repo of repositories) {
          if (explicitChoices.current.has(repo.repoRoot)) continue;
          const matches = repo.checkouts.filter(tree => tree.branch === branch);
          if (matches.length === 1) next[repo.repoRoot] = matches[0]!.path;
        }
      }
      return next;
    });
  };
  const beginCreate = () => {
    setIntroOpen(false);
    setNewName("");
    setMode("new");
    setChoices({});
    explicitChoices.current.clear();
    setError(null);
    setView("create");
  };
  const create = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const ws: WorkspaceInfo = await window.backchat.workspaceCreate({
        project_id: projectId,
        source_directory: projectId ? undefined : sourceDirectory,
        name,
        ...(mode === "existing" ? { checkouts: repositories.map(repo => ({ repoRoot: repo.repoRoot, path: choices[repo.repoRoot] ?? repo.path })) } : {}),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
      ]);
      if (mounted.current) {
        onSetWorkspace(ws.id);
        setOpen(false);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  if (isPending) return (
    <span className="app-compact-control inline-flex" data-composer-footer-control="workspace-loading">
      <Spinner className="size-3.5 text-fg-muted" aria-label={t("workspace.loading")} />
      <span>{t("common.loadingShort")}</span>
    </span>
  );
  if (!repositories.length) return null;
  return (
    <Popover open={isDraft && open} onOpenChange={next => {
      if (creating) return;
      setOpen(isDraft && next);
      setIntroOpen(false);
      if (next) setView("choose");
    }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm"
          data-composer-footer-control="workspace" data-workspace-id={workspaceId ?? ""}
          disabled={!isDraft || isFetching} aria-busy={isFetching} className="app-compact-control min-w-0 bg-transparent"
          title={selected?.roots.map(root => root.effectivePath).join("\n") ?? t("workspace.localHint")}>
          <span data-control-icon>{isFetching ? <Spinner aria-label={t("workspace.loading")} /> : selected ? <GitBranchIcon /> : <GitBranchIcon />}</span>
          <span className="max-w-[160px] truncate">{label}</span>
          {isDraft && <ChevronDownIcon data-control-chevron />}
        </Button>
      </PopoverTrigger>
      {isDraft && <PopoverContent side="top" align="start" sideOffset={0}
        className={`${view === "create" ? "w-[360px]" : "w-[var(--composer-menu-width)]"} max-w-[var(--radix-popover-content-available-width)] gap-0 overflow-hidden bg-transparent p-0 shadow-none ring-0`}>
        {view === "choose" ? <Command defaultValue={selected?.id ?? "local"}>
          <CommandInput autoFocus placeholder={t("workspace.search")} />
          <CommandList>
            <div className="relative" data-workspace-create-row>
              <CommandItem forceMount value="new-workspace" keywords={[t("workspace.new")]} onSelect={beginCreate} className="pr-10 text-xs">
                <PlusIcon className="size-3.5" />
                <span className="flex-1">{t("workspace.new")}</span>
              </CommandItem>
              <Popover open={introOpen} onOpenChange={setIntroOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-1/2 size-6 -translate-y-1/2 text-fg-subtle hover:text-fg" aria-label={t("workspace.about")} title={t("workspace.about")}>
                    <CircleAlertIcon className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" sideOffset={8}
                  onKeyDown={event => event.stopPropagation()}
                  aria-label={t("workspace.introTitle")}
                  className="app-select-content w-80 max-w-[var(--radix-popover-content-available-width)] gap-3 rounded-xl p-4"
                  onOpenAutoFocus={event => event.preventDefault()}
                  onCloseAutoFocus={event => event.preventDefault()}>
                  <div className="flex items-center gap-2 text-fg">
                    <CircleAlertIcon className="size-4 shrink-0 text-fg-muted" />
                    <h3 className="text-sm font-medium">{t("workspace.introTitle")}</h3>
                  </div>
                  <p className="text-xs leading-relaxed text-fg-muted">{t("workspace.introBody")}</p>
                  <p className="text-xs leading-relaxed text-fg-muted">{t("workspace.introOptions")}</p>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIntroOpen(false)}>{t("workspace.gotIt")}</Button>
                    <Button type="button" size="sm" onClick={() => { setIntroOpen(false); beginCreate(); setOpen(true); }}>{t("workspace.create")}</Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <CommandSeparator />
            <CommandItem value="local" keywords={[t("workspace.local"), "main"]} data-checked={!workspaceId || isLiveWorkspaceId(workspaceId)} onSelect={() => { onSetWorkspace(null); setOpen(false); }} className="text-xs" title={t("workspace.localHint")}>
              <GitBranchIcon className="size-3.5" />
              <span className="flex-1">{t("workspace.local")}</span>
              {liveBranch && <span className="text-fg-subtle">{liveBranch}</span>}
            </CommandItem>
            {saved.map(ws => <CommandItem key={ws.id} value={ws.id} keywords={[ws.name, ws.branch ?? ""]} data-checked={ws.id === workspaceId}
              onSelect={() => { onSetWorkspace(ws.id); setOpen(false); }} className="text-xs"
              title={ws.roots.map(root => `${folderName(root.sourcePath)} → ${root.effectivePath}`).join("\n")}>
              <GitBranchIcon className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{ws.name}</span>
              <span className="text-fg-subtle">{ws.worktrees.length} {t("workspace.repositories")}</span>
            </CommandItem>)}
          </CommandList>
        </Command> : <form className="app-select-content max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl p-3" onSubmit={event => { event.preventDefault(); void create(); }}>
          <div className="mb-3 flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" className="size-6" disabled={creating} aria-label={t("workspace.back")} onClick={() => setView("choose")}><ArrowLeftIcon className="size-3.5" /></Button>
            <span className="text-sm font-medium">{t("workspace.create")}</span>
          </div>
          <label className="block text-xs text-fg-muted">
            {t("workspace.name")}
            <Input autoFocus value={newName} disabled={creating} onChange={event => setNewName(event.target.value)} aria-label={t("workspace.name")} placeholder={t("workspace.nameHint")} className="mt-1.5 text-xs" />
          </label>
          <div className="mt-3 flex gap-1 rounded-lg bg-bg-surface/50 p-1" role="group" aria-label={t("workspace.setup")}>
            {(["new", "existing"] as const).map(value => <Button key={value} type="button" variant="ghost" size="sm" disabled={creating} aria-pressed={mode === value} onClick={() => setMode(value)} className={`h-7 flex-1 text-xs ${mode === value ? "bg-bg shadow-sm" : "text-fg-muted"}`}>{t(value === "new" ? "workspace.newTrees" : "workspace.existingTrees")}</Button>)}
          </div>
          <p className="mb-2 mt-2 text-xs leading-relaxed text-fg-muted">{t(mode === "new" ? "workspace.parallelHint" : "workspace.combineHint")}</p>
          <div className="max-h-56 overflow-y-auto divide-y divide-border/50">
            {repositories.map(repo => <div key={repo.repoRoot} className="flex min-h-12 items-center gap-3 py-2">
              <FolderOpenIcon className="size-3.5 shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 truncate text-xs" title={repo.repoRoot}>{folderName(repo.repoRoot)}</span>
              {mode === "new" ? <span className="max-w-40 truncate text-xs text-fg-muted">{newName.trim() || t("workspace.newTree")}</span> : <Select value={choices[repo.repoRoot] ?? repo.path} onValueChange={path => chooseCheckout(repo.repoRoot, path)} disabled={creating}>
                <SelectTrigger size="sm" className="max-w-44 text-xs" aria-label={t("workspace.checkoutLabel", { repository: folderName(repo.repoRoot) })}><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  {repo.checkouts.map(tree => <SelectItem key={tree.path} value={tree.path} title={tree.path} className="text-xs">{tree.branch ?? folderName(tree.path)}</SelectItem>)}
                </SelectContent>
              </Select>}
            </div>)}
          </div>
          {mode === "new" && <p className="mt-3 text-xs leading-relaxed text-fg-muted">{t("workspace.creationNotice")}</p>}
          {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
          <div className="mt-3 flex justify-end"><Button type="submit" size="sm" disabled={!newName.trim() || creating}>{t(creating ? "workspace.creating" : "workspace.create")}</Button></div>
        </form>}
      </PopoverContent>}
    </Popover>
  );
}
