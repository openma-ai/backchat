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
          className="app-no-drag inline-flex h-[var(--row-h)] shrink-0 items-center justify-center gap-1 px-2 text-[10px] font-medium tabular-nums text-fg-muted transition-colors hover:bg-[var(--control-bg-hover)] hover:text-fg focus-visible:bg-[var(--control-bg-hover)] focus-visible:text-fg"
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
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        style={{ width: "var(--agent-update-popover-width)" }}
        className="max-w-[var(--radix-popover-content-available-width)]"
      >
        <PopoverHeader>
          <div className="flex items-center gap-2">
            <PopoverTitle className="min-w-0 flex-1 truncate">
              {t("acpUpdates.title")}
            </PopoverTitle>
            {availableAgents.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                {t("acpUpdates.ready", { count: availableAgents.length })}
              </Badge>
            )}
          </div>
          <PopoverDescription className="text-xs leading-4">
            {t("acpUpdates.description")}
          </PopoverDescription>
        </PopoverHeader>

        {recentlyUpdated && (
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
        )}

        <div className="max-h-[min(300px,var(--radix-popover-content-available-height))] space-y-1 overflow-y-auto">
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
                    <p className="mt-1 flex items-start gap-1 text-[10px] leading-4 text-destructive">
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
                  variant="default"
                  size="xs"
                  onClick={() => void startUpgrade(agent)}
                  disabled={updating}
                  loading={updating}
                  loadingLabel={t("acpUpdates.updating")}
                  aria-label={actionLabel}
                >
                  {error ? t("acpUpdates.retry") : t("acpUpdates.update")}
                </Button>
              </div>
            );
          })}
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{t("acpUpdates.runningNotice")}</span>
        </p>
      </PopoverContent>
    </Popover>
  );
}
