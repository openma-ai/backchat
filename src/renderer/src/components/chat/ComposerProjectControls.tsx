import { useState } from "react";
import {
  ChevronDownIcon,
  FolderOpenIcon,
  GitBranchIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isLiveWorkspaceId, type WorkspaceInfo } from "@shared/workspaces";
import { WORKSPACES_QUERY_KEY } from "@/lib/workspace-query";
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
import { Button } from "@/components/ui/button";
import { selectRecentProjectPaths } from "@/lib/composer-project-paths";
import { useI18n } from "@/lib/i18n";
import { folderName } from "@/lib/project-path";
import { useSessionStore, selectActive } from "@/lib/session-store";
import { RuntimeLocationControl } from "./RuntimeLocationControl";

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
  onPickCwd: () => void | Promise<void>;
  onSetCwd: (path: string) => void;
  onClearCwd: () => void;
  /** Named project the draft belongs to; enables the workspace picker. */
  projectId?: string;
  /** Selected workspace; undefined/live = source folders. */
  workspaceId?: string | null;
  onSetWorkspace?: (workspaceId: string | null) => void;
}) {
  const { t } = useI18n();
  const remoteTarget = useSessionStore(selectActive)?.executionTarget;
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectPickerValue, setProjectPickerValue] = useState("");
  const { data: persisted = [] } = useQuery({
    queryKey: ["sessions-for-recent-cwds"],
    queryFn: () => window.backchat.sessionsList(50),
    staleTime: 30_000,
  });
  const recents = selectRecentProjectPaths(persisted);

  const { data: branch } = useQuery({
    queryKey: ["git-branch", activeCwd],
    queryFn: () =>
      activeCwd
        ? window.backchat.uiFsGitBranch({ path: activeCwd })
        : Promise.resolve(null),
    enabled: !!activeCwd && !remoteTarget,
    staleTime: 10_000,
  });

  const cwdLabel = activeCwd ? folderName(activeCwd) : t("chat.chooseProject");
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
              <FolderOpenIcon />
            </span>
            <span className="max-w-[200px] truncate">{cwdLabel}</span>
            {isDraft && <ChevronDownIcon data-control-chevron />}
          </Button>
        </PopoverTrigger>
        {isDraft && (
          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-[var(--composer-menu-width)] max-w-[var(--radix-popover-content-available-width)] gap-0 overflow-hidden bg-transparent p-0 shadow-none ring-0"
          >
            <Command
              value={projectPickerValue}
              onValueChange={setProjectPickerValue}
            >
              <CommandInput
                autoFocus
                placeholder={t("chat.chooseProject")}
              />
              <CommandList>
                {recents.map((path) => (
                  <CommandItem
                    key={path}
                    value={path}
                    data-checked={path === activeCwd}
                    onSelect={() => {
                      onSetCwd(path);
                      setProjectPickerOpen(false);
                    }}
                    className="text-xs"
                    title={path}
                  >
                    <FolderOpenIcon className="size-3.5 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate">
                      {folderName(path)}
                    </span>
                  </CommandItem>
                ))}
                {recents.length > 0 && <CommandSeparator />}
                <CommandItem
                  value={`${t("common.browse")} browse`}
                  onSelect={() => {
                    setProjectPickerOpen(false);
                    void onPickCwd();
                  }}
                  className="text-xs"
                >
                  <FolderOpenIcon className="size-3.5 text-fg-subtle" />
                  <span>{t("common.browse")}</span>
                </CommandItem>
                <CommandItem
                  value={noProjectCommandValue}
                  data-checked={!activeCwd}
                  onSelect={() => {
                    onClearCwd();
                    setProjectPickerOpen(false);
                  }}
                  className="text-xs"
                >
                  <XIcon className="size-3.5 text-fg-subtle" />
                  <span>{t("chat.noProject")}</span>
                </CommandItem>
              </CommandList>
            </Command>
          </PopoverContent>
        )}
      </Popover>}

      {!remoteTarget && projectId && onSetWorkspace ? (
        <WorkspaceChip
          isDraft={isDraft}
          projectId={projectId}
          workspaceId={workspaceId ?? null}
          liveBranch={branch ?? null}
          onSetWorkspace={onSetWorkspace}
        />
      ) : !remoteTarget && branch && (
        <span
          className="app-compact-control inline-flex"
          title={`Branch · ${branch}`}
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
  workspaceId,
  liveBranch,
  onSetWorkspace,
}: {
  isDraft: boolean;
  projectId: string;
  workspaceId: string | null;
  liveBranch: string | null;
  onSetWorkspace: (workspaceId: string | null) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const { data: workspaces = [] } = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: () => window.backchat.workspacesList(),
    staleTime: 30_000,
  });
  const options = workspaces.filter(
    (ws) => ws.project_id === projectId && ws.kind !== "live",
  );
  const selected =
    workspaceId && !isLiveWorkspaceId(workspaceId)
      ? options.find((ws) => ws.id === workspaceId)
      : undefined;
  const label = selected
    ? selected.name
    : workspaceId && !isLiveWorkspaceId(workspaceId)
      ? workspaceId
      : liveBranch ?? t("workspace.live");
  const title = selected
    ? `${t("workspace.picker")} · ${selected.name}${selected.branch ? ` (${selected.branch})` : ""}`
    : `${t("workspace.live")}${liveBranch ? ` · ${liveBranch}` : ""}`;

  const create = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const ws: WorkspaceInfo = await window.backchat.workspaceCreate({ project_id: projectId, name });
      await queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
      onSetWorkspace(ws.id);
      setNewName("");
      setOpen(false);
    } catch (error) {
      toast.error(t("workspace.createFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover open={isDraft && open} onOpenChange={(next) => setOpen(isDraft && next)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-composer-footer-control="workspace"
          data-workspace-id={workspaceId ?? ""}
          disabled={!isDraft}
          className="app-compact-control min-w-0 bg-transparent"
          title={title}
        >
          <span data-control-icon>
            <GitBranchIcon />
          </span>
          <span className="max-w-[160px] truncate">{label}</span>
          {isDraft && <ChevronDownIcon data-control-chevron />}
        </Button>
      </PopoverTrigger>
      {isDraft && (
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[var(--composer-menu-width)] max-w-[var(--radix-popover-content-available-width)] gap-0 overflow-hidden bg-transparent p-0 shadow-none ring-0"
        >
          <Command>
            <CommandInput
              autoFocus
              placeholder={t("workspace.newName")}
              value={newName}
              onValueChange={setNewName}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newName.trim()) {
                  event.preventDefault();
                  void create();
                }
              }}
            />
            <CommandList>
              <CommandItem
                value={`${t("workspace.live")} live`}
                data-checked={!selected}
                onSelect={() => {
                  onSetWorkspace(null);
                  setOpen(false);
                }}
                className="text-xs"
              >
                <FolderOpenIcon className="size-3.5 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate">{t("workspace.live")}</span>
                {liveBranch && <span className="truncate text-fg-subtle">{liveBranch}</span>}
              </CommandItem>
              {options.map((ws) => (
                <CommandItem
                  key={ws.id}
                  value={`${ws.name} ${ws.branch ?? ""} ${ws.id}`}
                  data-checked={ws.id === selected?.id}
                  onSelect={() => {
                    onSetWorkspace(ws.id);
                    setOpen(false);
                  }}
                  className="text-xs"
                  title={ws.roots[0]?.effectivePath}
                >
                  <GitBranchIcon className="size-3.5 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                  <span className="truncate text-fg-subtle">
                    {ws.kind === "external" ? t("workspace.external") : ws.branch ?? ""}
                  </span>
                </CommandItem>
              ))}
              {newName.trim() && (
                <>
                  <CommandSeparator />
                  <CommandItem
                    value={`${newName} create-workspace`}
                    onSelect={() => void create()}
                    disabled={creating}
                    className="text-xs"
                  >
                    <PlusIcon className="size-3.5 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate">
                      {creating ? t("workspace.creating") : `${t("workspace.create")}: ${newName.trim()}`}
                    </span>
                  </CommandItem>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      )}
    </Popover>
  );
}
