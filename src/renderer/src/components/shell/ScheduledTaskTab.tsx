import { useQuery } from "@tanstack/react-query";
import { CalendarClockIcon, ExternalLinkIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ScheduleInfo } from "@shared/schedules.js";

export function ScheduledTaskTab({
  schedule,
  onManage,
}: {
  schedule: ScheduleInfo;
  onManage: () => void;
}) {
  const { t, locale } = useI18n();
  const runs = useQuery({
    queryKey: ["schedule-runs", schedule.id],
    queryFn: () => window.backchat.scheduleRunsList({ schedule_id: schedule.id }),
    refetchInterval: schedule.status === "active" ? 3_000 : false,
  }).data ?? [];

  return (
    <div className="h-full overflow-y-auto px-4 pb-6 pt-3">
      <div className="flex min-w-0 items-start gap-3 border-b border-border/55 pb-4">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-bg-surface text-fg-muted">
          <CalendarClockIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-fg">{schedule.name}</h2>
          <p className="mt-0.5 text-[10px] text-fg-subtle">
            {t(`scheduled.${schedule.status}` as "scheduled.active")}
          </p>
        </div>
      </div>

      <section className="border-b border-border/55 py-4">
        <h3 className="text-xs font-medium text-fg">{t("scheduled.prompt")}</h3>
        <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-fg-muted">
          {schedule.prompt}
        </p>
      </section>

      <section className="border-b border-border/55 py-4">
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="text-fg-muted">{t("scheduled.when")}</span>
          <span className="text-right text-fg">
            {schedule.nextRunAt
              ? new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(schedule.nextRunAt)
              : t("scheduled.noNextRun")}
          </span>
        </div>
      </section>

      <section className="py-4">
        <h3 className="text-xs font-medium text-fg">{t("scheduled.recentRuns")}</h3>
        {runs.length === 0 ? (
          <p className="mt-2 text-xs text-fg-subtle">{t("scheduled.noRuns")}</p>
        ) : (
          <div className="mt-2 space-y-1">
            {runs.slice(0, 6).map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="capitalize text-fg-muted">{run.status}</span>
                <span className="text-[10px] text-fg-subtle">
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(run.scheduledFor)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        type="button"
        onClick={onManage}
        className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-bg-surface hover:text-fg"
      >
        {t("sidebar.scheduled")}
        <ExternalLinkIcon className="size-3.5" />
      </button>
    </div>
  );
}
