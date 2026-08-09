import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  CircleArrowUpIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import type { AgentInfo } from "@shared/api";
import { AgentIcon } from "@/components/AgentIcon";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";

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

export function AgentUpdateControl({ agents }: { agents: AgentInfo[] }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeIds, setActiveIds] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recentlyUpdated, setRecentlyUpdated] = useState<AgentInfo | null>(null);
  const availableAgents = useMemo(
    () => agents.filter((agent) => agent.updateAvailable),
    [agents],
  );

  const availableLabel = availableAgents.length === 1
    ? t("acpUpdates.availableOne")
    : t("acpUpdates.availableMany", { count: availableAgents.length });
  const triggerLabel = availableAgents.length > 0
    ? availableLabel
    : t("acpUpdates.updatedControl", {
        agent: recentlyUpdated?.label ?? "ACP",
      });

  const startUpgrade = async (agent: AgentInfo) => {
    if (activeIds.has(agent.id)) return;
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
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen && activeIds.size === 0) {
      setRecentlyUpdated(null);
    }
  };

  if (availableAgents.length === 0 && !recentlyUpdated) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title={triggerLabel}
          data-sidebar-agent-update-control="true"
          data-sidebar-agent-update-count={availableAgents.length || undefined}
          className="app-no-drag inline-flex h-[var(--row-h)] shrink-0 items-center justify-center gap-1 px-2 text-[10px] font-medium tabular-nums text-warning transition-colors hover:bg-warning-subtle/55 focus-visible:bg-warning-subtle/55"
        >
          {activeIds.size > 0 ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          ) : availableAgents.length > 0 ? (
            <CircleArrowUpIcon className="size-3.5" aria-hidden="true" />
          ) : (
            <CheckIcon className="size-3.5" aria-hidden="true" />
          )}
          {availableAgents.length > 0 && <span>{availableAgents.length}</span>}
        </button>
      </PopoverTrigger>

      <PopoverContent
        aria-label={t("acpUpdates.title")}
        data-sidebar-agent-update-popover="true"
        side="right"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className="w-[340px] max-w-[var(--radix-popover-content-available-width)] gap-0 overflow-hidden p-0"
      >
        <div className="px-3.5 pb-2 pt-3">
          <div className="flex items-center gap-3">
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
              {t("acpUpdates.title")}
            </h2>
            {availableAgents.length > 0 && (
              <span className="shrink-0 rounded-md bg-warning-subtle/45 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-warning">
                {t("acpUpdates.ready", { count: availableAgents.length })}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-4 text-fg-muted">
            {t("acpUpdates.description")}
          </p>
        </div>

        {recentlyUpdated && (
          <div
            role="status"
            className="mx-2 mb-1 flex items-center gap-2 rounded-md bg-success-subtle/55 px-2.5 py-2 text-[11px] font-medium text-success"
          >
            <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
            {t("acpUpdates.updatedTo", {
              agent: recentlyUpdated.label,
              version: recentlyUpdated.installedVersion
                ?? recentlyUpdated.latestVersion
                ?? t("acpUpdates.latestVersion"),
            })}
          </div>
        )}

        <div className="max-h-[min(300px,var(--radix-popover-content-available-height))] space-y-0.5 overflow-y-auto px-2 pb-1">
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
                className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-bg-surface/55"
              >
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-bg-surface/70 text-fg-muted">
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
                    className="truncate text-xs font-medium text-fg"
                  >
                    {agent.label}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] tabular-nums text-fg-subtle">
                    {updateDescription(agent, t("acpUpdates.newerRuntime"))}
                  </p>
                  {error && (
                    <p className="mt-1 flex items-start gap-1 text-[10px] leading-4 text-danger">
                      <TriangleAlertIcon
                        className="mt-0.5 size-3 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{error}</span>
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void startUpgrade(agent)}
                  disabled={updating}
                  aria-label={actionLabel}
                  className="text-warning hover:bg-warning-subtle/45 hover:text-warning"
                >
                  {updating && (
                    <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
                  )}
                  {updating
                    ? t("acpUpdates.updating")
                    : error
                      ? t("acpUpdates.retry")
                      : t("acpUpdates.update")}
                </Button>
              </div>
            );
          })}
        </div>

        <p className="mx-2 mb-2 mt-1 flex items-start gap-1.5 rounded-md bg-bg-surface/45 px-2.5 py-2 text-[10px] leading-4 text-fg-muted">
          <InfoIcon className="mt-0.5 size-3 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span>{t("acpUpdates.runningNotice")}</span>
        </p>
      </PopoverContent>
    </Popover>
  );
}
