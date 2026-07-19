import {
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  FolderOpenIcon,
  GitBranchIcon,
  MonitorIcon,
  XIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { selectRecentProjectPaths } from "@/lib/composer-project-paths";
import { useI18n } from "@/lib/i18n";
import { folderName } from "@/lib/project-path";
import { cn } from "@/lib/utils";

export function ProjectChipRow({
  isDraft,
  activeCwd,
  onPickCwd,
  onSetCwd,
  onClearCwd,
}: {
  isDraft: boolean;
  activeCwd: string;
  onPickCwd: () => void | Promise<void>;
  onSetCwd: (path: string) => void;
  onClearCwd: () => void;
}) {
  const { t } = useI18n();
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
    enabled: !!activeCwd,
    staleTime: 10_000,
  });

  const cwdLabel = activeCwd ? folderName(activeCwd) : t("chat.chooseProject");

  return (
    <div className="flex items-center gap-2 px-3 text-xs text-fg-muted">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!isDraft}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1",
            "hover:bg-bg-surface/60 focus:outline-none focus:bg-bg-surface/60",
            "transition-colors disabled:cursor-default disabled:hover:bg-transparent",
          )}
          title={activeCwd || t("chat.chooseProjectFolder")}
        >
          <FolderOpenIcon className="size-3.5" />
          <span className="max-w-[200px] truncate">{cwdLabel}</span>
          {isDraft && <ChevronDownIcon className="size-3 opacity-60" />}
        </DropdownMenuTrigger>
        {isDraft && (
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="min-w-[260px]"
          >
            {recents.length > 0 && (
              <>
                {recents.map((path) => (
                  <DropdownMenuItem
                    key={path}
                    onSelect={() => onSetCwd(path)}
                    className="flex items-center gap-2 text-xs"
                    title={path}
                  >
                    <FolderOpenIcon className="size-3.5 text-fg-subtle" />
                    <span className="flex-1 truncate">
                      {folderName(path)}
                    </span>
                    {path === activeCwd && (
                      <CheckIcon className="size-3.5 text-fg-muted" />
                    )}
                  </DropdownMenuItem>
                ))}
                <div className="my-1 h-px bg-border/60" />
              </>
            )}
            <DropdownMenuItem
              onSelect={() => void onPickCwd()}
              className="flex items-center gap-2 text-xs"
            >
              <FolderOpenIcon className="size-3.5 text-fg-subtle" />
              <span>{t("common.browse")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onClearCwd}
              className="flex items-center gap-2 text-xs"
            >
              <XIcon className="size-3.5 text-fg-subtle" />
              <span>{t("chat.noProject")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1",
            "hover:bg-bg-surface/60 focus:outline-none focus:bg-bg-surface/60",
            "transition-colors",
          )}
          title={t("chat.whereRuns")}
        >
          <MonitorIcon className="size-3.5" />
          <span>{t("chat.local")}</span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="min-w-[220px]"
        >
          <DropdownMenuItem className="flex items-center gap-2 text-xs">
            <MonitorIcon className="size-3.5 text-fg-subtle" />
            <span className="flex-1">{t("chat.local")}</span>
            <CheckIcon className="size-3.5 text-fg-muted" />
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled
            className="flex items-start gap-2 text-xs opacity-60"
          >
            <CloudIcon className="mt-0.5 size-3.5 text-fg-subtle" />
            <div className="min-w-0 flex-1">
              <div>{t("chat.cloud")}</div>
              <div className="text-[11px] text-fg-subtle">
                {t("chat.comingSoon")}
              </div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {branch && (
        <span
          className="inline-flex items-center gap-1 rounded-md px-2 py-1"
          title={`Branch · ${branch}`}
        >
          <GitBranchIcon className="size-3.5" />
          <span className="max-w-[160px] truncate">{branch}</span>
        </span>
      )}
    </div>
  );
}
