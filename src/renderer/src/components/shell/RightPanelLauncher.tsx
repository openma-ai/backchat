import {
  CalendarClockIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  ImageIcon,
  MessageSquareIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { SubagentAvatar } from "@/components/SubagentAvatar";
import { previewLocalFile } from "@/lib/file-preview";
import { useI18n } from "@/lib/i18n";
import type { AcpTerminalInfo } from "@shared/api.js";
import type { ScheduleInfo } from "@shared/schedules.js";
import type { PromptAttachment } from "@shared/session-events.js";
import type { WorkItemSnapshot } from "@openma/common/session-events/openma";
import {
  sessionStore,
  type SideTabType,
  type SubagentActivity,
  type WorkspaceArtifacts,
} from "@/lib/session-store";

export function RightPanelLauncher({
  onPick,
  onPickSubagent,
  onPickProcess,
  onOpenSchedule,
  canStartSideChat,
  browserEnabled,
  artifacts,
  subagents,
  workItems = [],
  processes,
  schedules,
  sourceAttachments = [],
}: {
  onPick: (type: SideTabType) => void;
  onPickSubagent: (activity: SubagentActivity) => void;
  onPickProcess: (process: AcpTerminalInfo) => void;
  onOpenSchedule: (schedule: ScheduleInfo) => void;
  canStartSideChat: boolean;
  browserEnabled: boolean;
  artifacts: WorkspaceArtifacts;
  subagents: SubagentActivity[];
  /** Canonical OpenMA work items. Provider-specific subagent rows are kept as
   *  a compatibility fallback, while this list is the source of truth for
   *  Background/Agent slot classification. */
  workItems?: WorkItemSnapshot[];
  processes: AcpTerminalInfo[];
  schedules: ScheduleInfo[];
  sourceAttachments?: PromptAttachment[];
}) {
  const { t } = useI18n();
  const providerSourceRefs = artifacts.sources ?? [];
  const sourcePaths = new Set([
    ...sourceAttachments.map((attachment) => attachment.path),
    ...providerSourceRefs.map((source) => source.uri),
  ]);
  const outputFiles = artifacts.files.filter((path) => !sourcePaths.has(path));
  const claimedSourceUris = new Set([
    ...sourceAttachments.map((attachment) => attachment.path),
  ]);
  const providerSources = providerSourceRefs.filter((source) => {
    if (claimedSourceUris.has(source.uri)) return false;
    claimedSourceUris.add(source.uri);
    return source.kind === "file" || browserEnabled;
  });
  const hasOutputs = outputFiles.length > 0;
  const agentWorkItems = workItems.filter((item) => item.kind === "agent");
  const backgroundWorkItems = workItems.filter(
    (item) => item.kind !== "agent" && item.kind !== "monitor",
  );
  const canonicalAgentIds = new Set(agentWorkItems.map((item) => item.id));
  const canonicalBackgroundIds = new Set(
    backgroundWorkItems.map((item) => item.id),
  );
  const processById = new Map(
    processes.map((process) => [process.terminalId, process]),
  );
  const hasAgents = agentWorkItems.length > 0 || subagents.length > 0;
  const hasBackground =
    backgroundWorkItems.length > 0 || schedules.length > 0 || processes.length > 0;
  const hasSources =
    sourceAttachments.length > 0
    || providerSources.length > 0;

  return (
    <div
      id="new-tab-page-panel"
      role="tabpanel"
      data-right-panel-launcher-list
      className="h-full overflow-y-auto pb-8 pt-3"
    >
      <section
        data-new-actions
        aria-label={t("rightPanel.newTab")}
        className="space-y-0.5 pl-2.5 pr-2"
      >
        <NewAction
          type="chat"
          label={t("sideChat.title")}
          hint={t("sideChat.forkHint")}
          icon={<MessageSquareIcon className="size-4" />}
          disabled={!canStartSideChat}
          onClick={() => onPick("chat")}
        />
        <NewAction
          type="file"
          label={t("sideChat.file")}
          hint={t("sideChat.fileHint")}
          icon={<FolderIcon className="size-4" />}
          onClick={() => onPick("file")}
        />
        {browserEnabled && (
          <NewAction
            type="browser"
            label={t("sideChat.browser")}
            hint={t("sideChat.browserHint")}
            icon={<GlobeIcon className="size-4" />}
            onClick={() => onPick("browser")}
          />
        )}
        <NewAction
          type="terminal"
          label={t("sideChat.terminal")}
          hint={t("sideChat.terminalHint")}
          icon={<SquareTerminalIcon className="size-4" />}
          onClick={() => onPick("terminal")}
        />
      </section>

      <div data-resource-list className="mt-5 space-y-4">
        {hasOutputs && (
          <ResourceSection category="outputs" title={t("rightPanel.outputs")}>
            {outputFiles.slice(0, 8).map((path) => (
              <ResourceRow
                key={`artifact:${path}`}
                label={basename(path)}
                hint={path}
                icon={<FileIcon className="size-4" />}
                onClick={() => void previewLocalFile(path)}
              />
            ))}
          </ResourceSection>
        )}

        {hasAgents && (
          <ResourceSection category="agents" title={t("rightPanel.agents")}>
            {agentWorkItems.map((item) => {
              const activity = subagents.find(
                (candidate) => candidate.childSessionId === item.id,
              );
              return (
                <ResourceRow
                  key={`work-item:${item.id}`}
                  label={
                    item.title
                    || activity?.native?.nickname
                    || activity?.task
                    || item.id
                  }
                  hint={agentResourceHint(item.status, activity)}
                  icon={activity
                    ? <SubagentAvatar avatarId={activity.avatarId} className="size-4" />
                    : <MessageSquareIcon className="size-4" />}
                  onClick={activity ? () => onPickSubagent(activity) : undefined}
                />
              );
            })}
            {subagents
              .filter((activity) => !canonicalAgentIds.has(activity.childSessionId))
              .map((activity) => (
                <ResourceRow
                  key={`subagent:${activity.viewSessionId}`}
                  label={subagentLabel(activity)}
                  hint={agentResourceHint(activity.status, activity)}
                  icon={<SubagentAvatar avatarId={activity.avatarId} className="size-4" />}
                  onClick={() => onPickSubagent(activity)}
                />
              ))}
          </ResourceSection>
        )}

        {hasBackground && (
          <ResourceSection
            category="background"
            title={t("rightPanel.background")}
          >
            {backgroundWorkItems.map((item) => {
              const process = processById.get(item.id);
              return (
                <ResourceRow
                  key={`work-item:${item.id}`}
                  label={item.title || item.id}
                  hint={item.status}
                  icon={workItemIcon(item)}
                  onClick={process ? () => onPickProcess(process) : undefined}
                />
              );
            })}
            {schedules.map((schedule) => (
              <ResourceRow
                key={`schedule:${schedule.id}`}
                label={schedule.name}
                hint={t(`scheduled.${schedule.status}` as "scheduled.active")}
                icon={<CalendarClockIcon className="size-4" />}
                onClick={() => onOpenSchedule(schedule)}
              />
            ))}
            {processes
              .filter((process) => !canonicalBackgroundIds.has(process.terminalId))
              .map((process) => (
              <ResourceRow
                key={`process:${process.terminalId}`}
                label={processLabel(process)}
                hint={process.cwd}
                icon={<SquareTerminalIcon className="size-4" />}
                onClick={() => onPickProcess(process)}
              />
              ))}
          </ResourceSection>
        )}

        {hasSources && (
          <ResourceSection category="sources" title={t("rightPanel.sources")}>
            {sourceAttachments.map((attachment) => (
              <ResourceRow
                key={`attachment:${attachment.id}`}
                label={attachment.name}
                hint={attachment.path}
                icon={attachment.kind === "image"
                  ? <ImageIcon className="size-4" />
                  : <FileIcon className="size-4" />}
                onClick={() => void previewLocalFile(attachment.path)}
              />
            ))}
            {providerSources.map((source) => (
              <ResourceRow
                key={`provider-source:${source.kind}:${source.uri}`}
                label={source.label || (source.kind === "file"
                  ? basename(source.uri)
                  : shortenServiceUrl(source.uri))}
                hint={source.uri}
                icon={source.kind === "file"
                  ? <FileIcon className="size-4" />
                  : <GlobeIcon className="size-4" />}
                onClick={() => source.kind === "file"
                  ? void previewLocalFile(source.uri)
                  : sessionStore.openSideTab("browser", source.uri, source.label)}
              />
            ))}
          </ResourceSection>
        )}
      </div>
    </div>
  );
}

function NewAction({
  type,
  label,
  hint,
  icon,
  onClick,
  disabled,
}: {
  type: "chat" | "file" | "browser" | "terminal";
  label: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-new-action={type}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid min-h-11 w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-lg py-1.5 text-left text-fg transition-colors hover:bg-bg-surface/60 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-surface/65 text-fg-subtle">
        {icon}
      </span>
      <span data-launcher-label className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-[11px] text-fg-subtle">{hint}</span>
      </span>
    </button>
  );
}

function ResourceSection({
  category,
  title,
  children,
}: {
  category: "outputs" | "agents" | "background" | "sources";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section data-resource-category={category} className="pl-2.5 pr-2">
      <h2 className="ml-2 text-xs font-medium text-fg-muted">
        {title}
      </h2>
      <div className="mt-1 space-y-0.5">{children}</div>
    </section>
  );
}

function ResourceRow({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={`${label}\n${hint}`}
      onClick={onClick}
      disabled={!onClick}
      className="grid h-8 w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-md text-left text-sm text-fg transition-colors hover:bg-bg-surface/60 disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center text-fg-subtle">
        {icon}
      </span>
      <span data-launcher-label className="min-w-0 flex-1 truncate">
        {label}
      </span>
    </button>
  );
}

function workItemIcon(item: WorkItemSnapshot): React.ReactNode {
  if (item.kind === "monitor") return <GlobeIcon className="size-4" />;
  if (item.kind === "bash") return <SquareTerminalIcon className="size-4" />;
  return <MessageSquareIcon className="size-4" />;
}

function subagentLabel(activity: SubagentActivity): string {
  return activity.native?.nickname
    || activity.task
    || activity.native?.agentType
    || activity.childSessionId;
}

function agentResourceHint(
  status: string,
  activity: SubagentActivity | undefined,
): string {
  const totalTokens =
    activity?.native?.usage?.totalTokens
    ?? activity?.native?.progress?.usage?.totalTokens;
  return totalTokens === undefined
    ? status
    : `${status} · ${totalTokens.toLocaleString()} tokens`;
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
