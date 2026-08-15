import { CalendarClockIcon } from "lucide-react";
import { useRightRailExpansion } from "@/components/shell/AppShell";
import { useI18n } from "@/lib/i18n";
import {
  formatScheduleFrequency,
  schedulesCreatedByTools,
  type ScheduleCreateSurface,
  type ScheduleToolLike,
} from "@/lib/scheduled-task-presentation";
import { sessionStore } from "@/lib/session-store";
import { cn } from "@/lib/utils";

export function TurnScheduleCards({
  sessionId,
  tools,
}: {
  sessionId: string;
  tools: readonly ScheduleToolLike[];
}) {
  const cards = schedulesCreatedByTools(tools);
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-schedule-cards="true">
      {cards.map((card) => (
        <ScheduledTaskMessageBar
          key={card.id ?? card.name}
          sessionId={sessionId}
          card={card}
        />
      ))}
    </div>
  );
}

function ScheduledTaskMessageBar({
  sessionId,
  card,
}: {
  sessionId: string;
  card: ScheduleCreateSurface;
}) {
  const { t, locale } = useI18n();
  const { selectPanel } = useRightRailExpansion();
  const frequency = card.trigger
    ? formatScheduleFrequency(card.trigger, locale)
    : null;
  const open = () => {
    const payload = card.id ?? card.name;
    const existing = sessionStore.sideTabs().find(
      (tab) => tab.type === "schedule" && tab.payload === payload,
    );
    sessionStore.openSideTabForTask(
      sessionId,
      "schedule",
      payload,
      card.name,
      existing?.id,
    );
    selectPanel();
  };

  return (
    <div
      data-schedule-card={card.id ?? card.name}
      className="flex h-10 min-w-0 items-center gap-2 rounded-lg bg-bg-bubble px-2.5 text-xs"
    >
      <CalendarClockIcon className="size-3.5 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-fg">{card.name}</span>
        {frequency && (
          <span className="text-fg-subtle">{` / ${frequency}`}</span>
        )}
      </span>
      <button
        type="button"
        data-schedule-open={card.id ?? card.name}
        onClick={open}
        className={cn(
          "inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs text-fg-muted",
          "transition-colors hover:bg-[var(--control-bg-hover)] hover:text-fg",
          "focus-visible:outline-none focus-visible:bg-[var(--control-bg-hover)]",
        )}
      >
        {t("scheduled.open")}
      </button>
    </div>
  );
}
