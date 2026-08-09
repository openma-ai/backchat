import { useState } from "react";
import {
  ChevronDownIcon,
  FolderOpenIcon,
  GitBranchIcon,
  XIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
import { RuntimeLocationControl } from "./RuntimeLocationControl";

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
    enabled: !!activeCwd,
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

      <Popover
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
      </Popover>

      {branch && (
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
