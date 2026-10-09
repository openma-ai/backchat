import { AgentIcon } from "@/components/AgentIcon";
import { RefreshCwIcon } from "@/components/Icons";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Composer-scoped harness live-probe status — mirrors in-turn activity pill + refresh feel. */
export function ComposerHarnessProbeStatus({
  agentId,
  agentLabel,
  iconUrl,
  slow = false,
  className,
}: {
  agentId: string;
  agentLabel: string;
  iconUrl?: string;
  slow?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const harness = agentLabel.trim() || agentId;
  const statusText = slow
    ? t("chat.harnessProbeSlow", { harness })
    : t("chat.harnessProbeChecking", { harness });

  return (
    <div
      role="status"
      data-composer-harness-probe="true"
      data-composer-harness-probe-agent={agentId}
      aria-live="polite"
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-lg border border-border/50",
        "bg-[color-mix(in_srgb,var(--surface-panel)_88%,var(--bg))] px-2.5 py-1.5 text-xs",
        className,
      )}
    >
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <AgentIcon
          agentId={agentId}
          iconUrl={iconUrl}
          className="size-4 shrink-0"
          title={harness}
        />
        <RefreshCwIcon
          className="absolute -right-0.5 -bottom-0.5 size-3 animate-spin text-info"
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 truncate font-medium text-fg">{statusText}</span>
    </div>
  );
}
