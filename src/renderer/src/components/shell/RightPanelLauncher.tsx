import { useEffect, useState } from "react";
import {
  ChevronDownIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  MessageSquareIcon,
  PlusIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { SubagentAvatar } from "@/components/SubagentAvatar";
import { previewLocalFile } from "@/lib/file-preview";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AcpTerminalInfo } from "@shared/api.js";
import { sessionStore, type SideTabType, type SubagentActivity, type WorkspaceArtifacts } from "@/lib/session-store";

export function RightPanelLauncher({
  onPick,
  onPickSubagent,
  onPickProcess,
  canStartSideChat,
  browserEnabled,
  artifacts,
  subagents,
  processes,
}: {
  onPick: (type: SideTabType) => void;
  onPickSubagent: (activity: SubagentActivity) => void;
  onPickProcess: (process: AcpTerminalInfo) => void;
  canStartSideChat: boolean;
  browserEnabled: boolean;
  artifacts: WorkspaceArtifacts;
  subagents: SubagentActivity[];
  processes: AcpTerminalInfo[];
}) {
  const { t } = useI18n();
  const [processesOpen, setProcessesOpen] = useState(true);
  const [recent, setRecent] = useState<
    { name: string; path: string; isDir: boolean; mtime: number }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    const cwd = async () => {
      const path = await window.backchat.uiFsHome();
      try {
        const rows = await window.backchat.uiFsRecent({ path, limit: 6 });
        if (!cancelled) setRecent(rows);
      } catch {
        if (!cancelled) setRecent([]);
      }
    };
    void cwd();
    return () => { cancelled = true; };
  }, []);

  return (
    <div data-right-panel-launcher-list className="h-full overflow-y-auto px-4 pb-6 pt-1">
      <LauncherSection
        title={t("rightPanel.outputs")}
        action={<LauncherAction label={t("rightPanel.createOutput")} onClick={() => onPick("chat")} />}
      >
        {artifacts.files.length > 0 ? artifacts.files.slice(0, 8).map((path) => (
          <LauncherRow
            key={path}
            label={basename(path)}
            hint={path}
            icon={<FileIcon className="size-4" />}
            onClick={() => void previewLocalFile(path)}
          />
        )) : (
          <LauncherRow
            label={t("rightPanel.createOutput")}
            hint={t("rightPanel.createOutputHint")}
            icon={<MessageSquareIcon className="size-4" />}
            disabled={!canStartSideChat}
            onClick={() => onPick("chat")}
          />
        )}
      </LauncherSection>

      <section className="border-b border-border/45 py-4" data-background-processes>
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-sm font-medium text-fg-muted"
          onClick={() => setProcessesOpen((open) => !open)}
          aria-expanded={processesOpen}
        >
          <ChevronDownIcon className={cn("size-4 transition-transform", !processesOpen && "-rotate-90")} />
          <span>{t("rightPanel.backgroundProcesses")}</span>
        </button>
        {processesOpen && (
          <div className="mt-2 space-y-0.5">
            {subagents.length > 0 && (
              <div className="px-2 pb-1 pt-2 text-[10px] font-medium text-fg-subtle" data-current-subagents>
                {t("rightPanel.currentSubagents")}
              </div>
            )}
            {subagents.map((activity) => (
              <LauncherRow
                key={activity.viewSessionId}
                label={subagentLabel(activity)}
                hint={activity.status}
                icon={<SubagentAvatar avatarId={activity.avatarId} className="size-4" />}
                onClick={() => onPickSubagent(activity)}
              />
            ))}
            {processes.map((process) => (
              <LauncherRow
                key={process.terminalId}
                label={processLabel(process)}
                hint={process.cwd}
                icon={<SquareTerminalIcon className="size-4" />}
                onClick={() => onPickProcess(process)}
              />
            ))}
            <LauncherRow
              label={t("rightPanel.backgroundTerminal")}
              hint={t("rightPanel.backgroundTerminalHint")}
              icon={<SquareTerminalIcon className="size-4" />}
              onClick={() => onPick("terminal")}
            />
            {browserEnabled && artifacts.services.map((url) => (
              <LauncherRow
                key={url}
                label={shortenServiceUrl(url)}
                hint={url}
                icon={<GlobeIcon className="size-4" />}
                onClick={() => sessionStore.openSideTab("browser", url, undefined)}
              />
            ))}
            {subagents.length === 0 && processes.length === 0 && artifacts.services.length === 0 && (
              <p className="px-2 py-2 text-xs text-fg-subtle">{t("rightPanel.noProcesses")}</p>
            )}
          </div>
        )}
      </section>

      <LauncherSection
        title={t("rightPanel.sources")}
        action={<LauncherAction label={t("rightPanel.openSources")} onClick={() => onPick("file")} />}
      >
        <LauncherRow
          label={t("rightPanel.projectFiles")}
          hint={t("rightPanel.projectFilesHint")}
          icon={<FolderIcon className="size-4" />}
          onClick={() => onPick("file")}
        />
        {browserEnabled && (
          <LauncherRow
            label={t("rightPanel.website")}
            hint={t("rightPanel.websiteHint")}
            icon={<GlobeIcon className="size-4" />}
            onClick={() => onPick("browser")}
          />
        )}
        {recent.slice(0, 4).map((entry) => (
          <LauncherRow
            key={entry.path}
            label={entry.name}
            hint={entry.isDir ? t("rightPanel.directory") : t("rightPanel.file")}
            icon={entry.isDir ? <FolderIcon className="size-4" /> : <FileIcon className="size-4" />}
            onClick={() => entry.isDir
              ? sessionStore.openSideTab("file", entry.path, entry.name)
              : void previewLocalFile(entry.path)}
          />
        ))}
        {recent.length === 0 && artifacts.files.length === 0 && (
          <p className="px-2 py-2 text-xs text-fg-subtle">{t("rightPanel.noSources")}</p>
        )}
        <LauncherRow
          label={t("rightPanel.viewAll")}
          hint={t("rightPanel.viewAllHint")}
          icon={<FolderIcon className="size-4" />}
          onClick={() => onPick("file")}
        />
      </LauncherSection>
    </div>
  );
}

function LauncherSection({
  title,
  action,
  children,
}: {
  title: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border/45 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-fg-muted">{title}</h2>
        {action}
      </div>
      <div className="mt-2 space-y-0.5">{children}</div>
    </section>
  );
}

function LauncherAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-surface/65 hover:text-fg"
    >
      <PlusIcon className="size-4" />
    </button>
  );
}

function LauncherRow({ label, hint, icon, onClick, disabled }: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-surface/60 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-bg-surface/65 text-fg-subtle">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-fg">{label}</span>
        <span className="block truncate text-[10px] text-fg-subtle">{hint}</span>
      </span>
    </button>
  );
}

function subagentLabel(activity: SubagentActivity): string {
  return activity.native?.nickname || activity.task || activity.native?.agentType || activity.childSessionId;
}

function processLabel(process: AcpTerminalInfo): string {
  return [process.command, ...process.args].join(" ") || "Background process";
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").pop() || path;
}

function shortenServiceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return url;
  }
}
