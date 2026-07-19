import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BotIcon, DatabaseIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentIcon } from "@/components/AgentIcon";
import { useI18n, type Locale, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ActivityStatsInfo, HarnessActivityInfo } from "@shared/api";
import { activityLevel, buildActivityGrid, formatUnitCount, type ActivityMetric } from "./activity-grid";
import { harnessDisplayName } from "./harness-display";

const metricOptions: Array<{ value: ActivityMetric; label: TranslationKey }> = [
  { value: "tasks", label: "activity.metricTasks" },
  { value: "turns", label: "activity.metricTurns" },
  { value: "tool_calls", label: "activity.metricTools" },
];
const levelClasses = [
  "bg-bg-bubble/65",
  "bg-info/25",
  "bg-info/45",
  "bg-info/70",
  "bg-info",
] as const;

export function SettingsActivity() {
  const { locale, t } = useI18n();
  const [metric, setMetric] = useState<ActivityMetric>("turns");
  const query = useQuery({
    queryKey: ["activity-stats"],
    queryFn: () => window.backchat.activityStats(),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-5 text-xs">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-sm font-medium text-fg">{t("activity.title")}</h1>
          <p className="mt-1 max-w-[68ch] text-[11px] leading-5 text-fg-muted">
            {t("activity.description")}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[10px] text-fg-subtle">
            <DatabaseIcon className="size-3" aria-hidden="true" />
            {t("activity.localOnly")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="h-7 gap-1.5 px-2 text-xs text-fg-muted hover:text-fg"
        >
          <RefreshCwIcon className={cn("size-3.5", query.isFetching && "animate-spin")} />
          {t("activity.refresh")}
        </Button>
      </header>

      {query.isLoading ? <LoadingPanel /> : query.data ? (
        <ActivityPanel
          stats={query.data}
          locale={locale}
          metric={metric}
          onMetricChange={setMetric}
        />
      ) : (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-border/55 px-6 text-center">
          <p className="text-sm font-medium text-fg">{t("activity.loadError")}</p>
          <p className="mt-1 max-w-md text-[11px] text-fg-muted">
            {query.error instanceof Error ? query.error.message : String(query.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} className="mt-4 h-7 text-xs">
            {t("activity.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ActivityPanel({
  stats,
  locale,
  metric,
  onMetricChange,
}: {
  stats: ActivityStatsInfo;
  locale: Locale;
  metric: ActivityMetric;
  onMetricChange: (metric: ActivityMetric) => void;
}) {
  const { t } = useI18n();
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    [locale],
  );
  const grid = useMemo(() => buildActivityGrid(stats.daily, metric), [stats.daily, metric]);
  const monthLabels = useMemo(() => buildMonthLabels(grid.weeks, locale), [grid.weeks, locale]);
  const averageTurns = stats.summary.total_tasks
    ? stats.summary.total_turns / stats.summary.total_tasks
    : 0;
  const cards = [
    [compact.format(stats.summary.total_tasks), t("activity.totalTasks")],
    [compact.format(stats.summary.total_turns), t("activity.totalTurns")],
    [compact.format(stats.summary.total_tool_calls), t("activity.toolCalls")],
    [formatUnitCount(stats.summary.current_streak_days, t("activity.day"), t("activity.days")), t("activity.currentStreak")],
    [formatUnitCount(stats.summary.longest_streak_days, t("activity.day"), t("activity.days")), t("activity.longestStreak")],
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-border/55 bg-bg/78">
      <div className="overflow-x-auto border-b border-border/45">
        <dl className="grid min-w-[660px] grid-cols-5">
          {cards.map(([value, label]) => (
            <div key={label} className="relative flex min-h-20 flex-col items-center justify-center px-4 py-4 text-center after:absolute after:right-0 after:h-9 after:w-px after:bg-border/45 last:after:hidden">
              <dd className="text-lg font-medium tabular-nums tracking-[-0.02em] text-fg">{value}</dd>
              <dt className="mt-0.5 text-[11px] text-fg-muted">{label}</dt>
            </div>
          ))}
        </dl>
      </div>

      <div className="px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-medium text-fg">{t("activity.heatmap")}</h2>
          <div className="flex rounded-lg bg-bg-surface p-0.5" aria-label={t("activity.heatmap")}>
            {metricOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={metric === option.value}
                onClick={() => onMetricChange(option.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] transition-colors",
                  metric === option.value
                    ? "bg-bg text-fg shadow-chip-press"
                    : "text-fg-subtle hover:text-fg",
                )}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto pb-1">
          <div className="min-w-[680px]">
            <div className="flex gap-1" role="img" aria-label={t("activity.heatmap")}>
              {grid.weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="grid min-w-0 flex-1 grid-rows-7 gap-1">
                  {week.map((cell, dayIndex) => cell ? (
                    <span
                      key={cell.date}
                      title={formatCell(cell.date, cell.value, locale)}
                      aria-label={formatCell(cell.date, cell.value, locale)}
                      className={cn(
                        "aspect-square min-h-2 rounded-[3px]",
                        levelClasses[activityLevel(cell.value, grid.max)],
                      )}
                    />
                  ) : (
                    <span key={dayIndex} className="aspect-square" aria-hidden="true" />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-1 text-[10px] text-fg-subtle" aria-hidden="true">
              {monthLabels.map((label, index) => (
                <span key={index} className="min-w-0 flex-1 whitespace-nowrap">{label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid border-t border-border/45 lg:grid-cols-[minmax(220px,0.72fr)_minmax(420px,1.28fr)]">
        <section className="px-5 py-5 sm:px-6 sm:py-6 lg:border-r lg:border-border/45">
          <h2 className="text-xs font-medium text-fg">{t("activity.insights")}</h2>
          <dl className="mt-4 space-y-3">
            <Insight label={t("activity.activeDays")} value={compact.format(stats.summary.active_days)} />
            <Insight label={t("activity.harnessRuns")} value={compact.format(stats.summary.total_runs)} />
            <Insight label={t("activity.harnessesUsed")} value={compact.format(stats.summary.total_harnesses)} />
            <Insight label={t("activity.avgTurns")} value={new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(averageTurns)} />
          </dl>
        </section>
        <HarnessBreakdown harnesses={stats.harnesses} totalTurns={stats.summary.total_turns} locale={locale} />
      </div>
    </section>
  );
}

function HarnessBreakdown({ harnesses, totalTurns, locale }: {
  harnesses: HarnessActivityInfo[];
  totalTurns: number;
  locale: Locale;
}) {
  const { t } = useI18n();
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return (
    <section className="border-t border-border/45 px-5 py-5 sm:px-6 sm:py-6 lg:border-t-0">
      <h2 className="text-xs font-medium text-fg">{t("activity.harnessBusiness")}</h2>
      {harnesses.length === 0 ? (
        <div className="mt-4 flex min-h-24 items-center gap-3 text-[11px] text-fg-muted">
          <BotIcon className="size-4 text-fg-subtle" />
          {t("activity.noHarnessData")}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border/35">
          {harnesses.map((harness) => {
            const label = harness.harness_label ?? harnessDisplayName(harness.harness_id);
            return (
              <li key={harness.harness_id} className="flex min-w-0 items-center gap-3 py-3 first:pt-1 last:pb-0">
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-info-subtle text-info">
                  <HarnessIcon harness={harness} label={label} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-fg">{label}</p>
                  <p className="mt-0.5 text-[10px] text-fg-subtle">
                    {t("activity.lastActive", { date: date.format(new Date(harness.last_active_at)) })}
                  </p>
                </div>
                <div className="hidden gap-3 text-[10px] text-fg-muted sm:flex">
                  <span>{formatUnitCount(harness.tasks, t("activity.task"), t("activity.metricTasks").toLowerCase())}</span>
                  <span>{formatUnitCount(harness.runs, t("activity.run"), t("activity.runs"))}</span>
                  <span>{formatUnitCount(harness.tool_calls, t("activity.tool"), t("activity.tools"))}</span>
                </div>
                <div className="w-14 text-right">
                  <p className="text-xs font-medium tabular-nums text-fg">{percent.format(totalTurns ? harness.turns / totalTurns : 0)}</p>
                  <p className="text-[9px] text-fg-subtle">{t("activity.share")}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HarnessIcon({ harness, label }: {
  harness: HarnessActivityInfo;
  label: string;
}) {
  const [registryIconFailed, setRegistryIconFailed] = useState(false);
  if (harness.icon_url && !registryIconFailed) {
    return (
      <img
        src={harness.icon_url}
        alt={label}
        className="size-4 object-contain"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setRegistryIconFailed(true)}
      />
    );
  }
  return (
    <AgentIcon
      agentId={harness.harness_id}
      title={label}
      className="size-3.5"
    />
  );
}

function Insight({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-4"><dt className="text-[11px] text-fg-muted">{label}</dt><dd className="font-medium tabular-nums text-fg">{value}</dd></div>;
}

function LoadingPanel() {
  return (
    <div className="overflow-hidden rounded-xl border border-border/55" aria-hidden="true">
      <div className="grid grid-cols-5 border-b border-border/45">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex h-20 flex-col items-center justify-center gap-2"><Skeleton className="h-5 w-14" /><Skeleton className="h-2.5 w-20" /></div>)}
      </div>
      <div className="space-y-5 p-6"><Skeleton className="h-4 w-40" /><Skeleton className="h-40 w-full" /></div>
    </div>
  );
}

function buildMonthLabels(weeks: ReturnType<typeof buildActivityGrid>["weeks"], locale: Locale): string[] {
  let previous = "";
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  return weeks.map((week) => {
    const first = week.find(Boolean);
    if (!first) return "";
    const month = first.date.slice(0, 7);
    if (month === previous) return "";
    previous = month;
    return formatter.format(new Date(`${first.date}T00:00:00Z`));
  });
}

function formatCell(day: string, value: number, locale: Locale): string {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`));
  return `${date}: ${value}`;
}
