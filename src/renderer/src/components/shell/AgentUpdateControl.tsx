import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  CircleArrowUpIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "@/components/Icons";

import type { AgentInfo } from "@shared/api";
import { AgentIcon } from "@/components/AgentIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UpdateProgressBar } from "@/components/ui/update-progress";
import { useGapAdjacentPx } from "@/components/ui/gap-adjacent";
import { useI18n } from "@/lib/i18n";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";
import { markAgentUpgrading } from "@/lib/agent-upgrade-store";
import {
  appUpdateSubject,
  updateStatusKey,
  useAppUpdateState,
} from "@/lib/unified-update";

const MIN_PROGRESS_VISIBLE_MS = 480;

function mergeUpdatedAgent(
  current: AgentInfo[] | undefined,
  snapshot: AgentInfo[],
  agentId: string,
): AgentInfo[] {
  const updated = snapshot.find((agent) => agent.id === agentId);
  if (!current) return snapshot;
  if (!updated) return current;
  const found = current.some((agent) => agent.id === agentId);
  return found
    ? current.map((agent) => agent.id === agentId ? updated : agent)
    : [...current, updated];
}

function updateDescription(agent: AgentInfo, fallback: string): string {
  return agent.installedVersion && agent.latestVersion
    ? `${agent.installedVersion} → ${agent.latestVersion}`
    : fallback;
}

interface AgentUpdateActionProps {
  actionLabel: string;
  error?: string;
  retryLabel: string;
  updateLabel: string;
  updating: boolean;
  updatingLabel: string;
  onUpgrade: () => void;
}

export function AgentUpdateAction({
  actionLabel,
  error,
  retryLabel,
  updateLabel,
  updating,
  updatingLabel,
  onUpgrade,
}: AgentUpdateActionProps) {
  if (updating) {
    return (
      <div
        role="status"
        aria-label={actionLabel}
        data-agent-update-spinner="true"
        className="inline-flex w-20 shrink-0 items-center justify-center gap-1 text-[10px] leading-3 text-muted-foreground"
      >
        <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
        <span>{updatingLabel}</span>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={onUpgrade}
      aria-label={actionLabel}
    >
      {error ? retryLabel : updateLabel}
    </Button>
  );
}

interface AgentUpdateErrorProps {
  detailsLabel: string;
  diskSpaceMessage: string;
  error: string;
  fallbackMessage: string;
  npmMissingMessage?: string;
  timeoutMessage?: string;
}

export function AgentUpdateError({
  detailsLabel,
  diskSpaceMessage,
  error,
  fallbackMessage,
  npmMissingMessage = fallbackMessage,
  timeoutMessage = fallbackMessage,
}: AgentUpdateErrorProps) {
  const message = /ENOSPC|no space left on device|insufficient space/i.test(error)
    ? diskSpaceMessage
    : /spawn npm ENOENT|npm.*not found|command not found.*npm/i.test(error)
      ? npmMissingMessage
      : /SIGTERM|timed? out|ETIMEDOUT/i.test(error)
        ? timeoutMessage
        : fallbackMessage;

  return (
    <details data-agent-update-error="true" className="group mt-1">
      <summary
        aria-label={detailsLabel}
        title={detailsLabel}
        className="inline-flex size-5 cursor-pointer list-none items-center justify-center rounded-md text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-destructive/30 [&::-webkit-details-marker]:hidden"
      >
        <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
        <span className="sr-only">{detailsLabel}</span>
      </summary>
      <div className="mt-1.5 rounded-md border border-destructive/20 bg-destructive/5 p-2 text-[10px] leading-4">
        <p className="text-destructive">{message}</p>
        <pre className="oma-scrollbar mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-micro leading-3.5 text-muted-foreground">
          {error}
        </pre>
      </div>
    </details>
  );
}

/**
 * The unified update control in the sidebar footer.
 *
 * It covers the App and the managed agents with one vocabulary and one set
 * of actions. The App half follows the same three-step flow as Settings →
 * About: check discovers, download fetches, restart installs. Checking
 * never downloads, so the control cannot start a download the user did not
 * ask for.
 *
 * The trigger stays out of the way until there is something to act on —
 * a quiet sidebar is worth more than a permanently visible counter.
 */
export function AgentUpdateControl({ agents }: { agents: AgentInfo[] }) {
  const gapAdjacent = useGapAdjacentPx();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeIds, setActiveIds] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recentlyUpdated, setRecentlyUpdated] = useState<AgentInfo | null>(null);
  const appState = useAppUpdateState();
  const app = appUpdateSubject(appState, t);
  const availableAgents = useMemo(
    () => agents.filter((agent) => agent.updateAvailable),
    [agents],
  );

  const appActionable =
    app.status === "updateAvailable"
    || app.status === "ready"
    || app.status === "downloading";
  const totalCount = availableAgents.length + (appActionable ? 1 : 0);

  const triggerLabel = totalCount === 1
    ? t("update.sidebar.availableOne")
    : totalCount > 1
      ? t("update.sidebar.availableMany", { count: totalCount })
      : recentlyUpdated
        ? t("acpUpdates.updatedControl", { agent: recentlyUpdated.label ?? "ACP" })
        : t("update.title");

  const startUpgrade = async (agent: AgentInfo) => {
    if (activeIds.has(agent.id)) return;
    // Claim the agent in the shared registry so Settings → About shows the
    // same "Upgrading…" line while npm runs.
    if (!markAgentUpgrading(agent.id, true)) return;
    setActiveIds((current) => new Set(current).add(agent.id));
    setErrors((current) => {
      const next = { ...current };
      delete next[agent.id];
      return next;
    });
    const startedAt = Date.now();

    try {
      const snapshot = await window.backchat.agentUpgrade(agent.id);
      const remaining = Math.max(
        0,
        MIN_PROGRESS_VISIBLE_MS - (Date.now() - startedAt),
      );
      if (remaining > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
      }

      const updated = snapshot.find((candidate) => candidate.id === agent.id) ?? {
        ...agent,
        installedVersion: agent.latestVersion,
        updateAvailable: false,
      };
      const merge = (current: AgentInfo[] | undefined) =>
        mergeUpdatedAgent(current, snapshot, agent.id);
      queryClient.setQueryData<AgentInfo[]>(AGENTS_QUERY_KEY, merge);
      void queryClient.invalidateQueries({ queryKey: ["session-runtime"] });
      setRecentlyUpdated(updated);
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [agent.id]: error instanceof Error
          ? error.message
          : t("acpUpdates.failed"),
      }));
    } finally {
      setActiveIds((current) => {
        const next = new Set(current);
        next.delete(agent.id);
        return next;
      });
      markAgentUpgrading(agent.id, false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen && activeIds.size === 0) {
      setRecentlyUpdated(null);
    }
  };

  if (totalCount === 0 && !recentlyUpdated) return null;

  const busy = app.busy || activeIds.size > 0;
  const percent = appState?.progress?.percent ?? 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title={triggerLabel}
          data-sidebar-agent-update-control="true"
          data-sidebar-agent-update-count={totalCount || undefined}
          className="app-no-drag sidebar-update-action inline-flex shrink-0 items-center justify-center text-small font-medium tabular-nums"
        >
          {busy ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          ) : totalCount > 0 ? (
            <CircleArrowUpIcon className="size-3.5" aria-hidden="true" />
          ) : (
            <CheckIcon className="size-3.5" aria-hidden="true" />
          )}
          {totalCount > 0 && <span>{totalCount}</span>}
        </button>
      </PopoverTrigger>

      <PopoverContent
        aria-label={t("update.title")}
        data-sidebar-agent-update-popover="true"
        side="top"
        align="start"
        sideOffset={gapAdjacent}
        collisionPadding={8}
        style={{ width: "var(--agent-update-popover-width)" }}
        className="max-w-[var(--radix-popover-content-available-width)]"
      >
        <PopoverHeader>
          <div className="flex items-center gap-2">
            <PopoverTitle className="min-w-0 flex-1 truncate">
              {t("update.title")}
            </PopoverTitle>
            {totalCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                {t("acpUpdates.ready", { count: totalCount })}
              </Badge>
            )}
          </div>
          <PopoverDescription className="text-xs leading-4">
            {t("update.description")}
          </PopoverDescription>
        </PopoverHeader>

        {/* The App half of the control — check, download, restart. */}
        <div data-sidebar-app-update="true" className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-foreground">Backchat</span>
            <span
              data-sidebar-app-update-status={app.status}
              className="text-[11px] text-muted-foreground"
            >
              {t(updateStatusKey(app.status))}
            </span>
          </div>
          {app.detail ? (
            <p className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
              {app.detail}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {app.status === "updateAvailable" && appState?.canInstall ? (
              <Button
                type="button"
                size="xs"
                data-sidebar-app-download="true"
                onClick={() => {
                  void window.backchat.updateDownload().catch(() => undefined);
                }}
              >
                {t("update.download")}
              </Button>
            ) : app.status === "ready" && appState?.canInstall ? (
              <Button
                type="button"
                size="xs"
                data-sidebar-app-restart="true"
                onClick={() => {
                  void window.backchat.updateInstall().catch(() => undefined);
                }}
              >
                {t("update.restart")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="xs"
                data-sidebar-app-check="true"
                disabled={app.busy}
                onClick={() => {
                  // Check only — discovery never downloads.
                  void window.backchat.updateCheck().catch(() => undefined);
                }}
              >
                {t("update.check")}
              </Button>
            )}
          </div>
          {app.status === "downloading" ? (
            <div className="flex items-center gap-1.5 pt-0.5">
              <UpdateProgressBar
                percent={percent}
                label={t("update.progressLabel", { percent })}
                className="flex-1"
              />
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {percent}%
              </span>
            </div>
          ) : null}
        </div>

        {availableAgents.length > 0 ? (
          <>
            <div className="h-px w-full bg-fg/10" aria-hidden="true" />
            <div className="oma-scrollbar max-h-[min(300px,var(--radix-popover-content-available-height))] space-y-1 overflow-y-auto">
              {availableAgents.map((agent) => {
                const updating = activeIds.has(agent.id);
                const error = errors[agent.id];
                const actionLabel = updating
                  ? t("acpUpdates.updatingAgent", { agent: agent.label })
                  : error
                    ? t("acpUpdates.retryAgent", { agent: agent.label })
                    : t("acpUpdates.updateAgent", { agent: agent.label });
                return (
                  <div
                    key={agent.id}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md p-1.5 transition-colors hover:bg-muted/50"
                  >
                    <span className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                      <AgentIcon
                        agentId={agent.id}
                        iconUrl={agent.icon}
                        title={agent.label}
                        className="size-3.5"
                      />
                    </span>
                    <div className="min-w-0">
                      <p
                        data-agent-update-label={agent.id}
                        className="truncate text-xs font-medium text-foreground"
                      >
                        {agent.label}
                      </p>
                      <p className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
                        {updateDescription(agent, t("acpUpdates.newerRuntime"))}
                      </p>
                      {error && (
                        <AgentUpdateError
                          detailsLabel={t("acpUpdates.errorDetails")}
                          diskSpaceMessage={t("acpUpdates.diskSpaceError")}
                          npmMissingMessage={t("acpUpdates.npmMissingError")}
                          timeoutMessage={t("acpUpdates.timeoutError")}
                          fallbackMessage={t("acpUpdates.failed")}
                          error={error}
                        />
                      )}
                    </div>
                    <AgentUpdateAction
                      actionLabel={actionLabel}
                      error={error}
                      retryLabel={t("acpUpdates.retry")}
                      updateLabel={t("acpUpdates.update")}
                      updating={updating}
                      updatingLabel={t("acpUpdates.updating")}
                      onUpgrade={() => void startUpgrade(agent)}
                    />
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {recentlyUpdated ? (
          <p
            role="status"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <CheckIcon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            {t("acpUpdates.updatedTo", {
              agent: recentlyUpdated.label,
              version: recentlyUpdated.installedVersion
                ?? recentlyUpdated.latestVersion
                ?? t("acpUpdates.latestVersion"),
            })}
          </p>
        ) : null}

        <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{t("acpUpdates.runningNotice")}</span>
        </p>
      </PopoverContent>
    </Popover>
  );
}
