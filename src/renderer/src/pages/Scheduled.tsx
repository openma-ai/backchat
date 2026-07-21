import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CirclePauseIcon,
  Clock3Icon,
  HistoryIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { buildScheduleTrigger, type ScheduleTriggerDraft } from "@/lib/scheduled-page-model";
import type {
  ScheduleInfo,
  ScheduleNotificationPolicy,
  ScheduleRunInfo,
  ScheduleTarget,
} from "@shared/schedules.js";
import type { PersistedSessionInfo } from "@shared/api.js";

type TriggerKind = ScheduleTriggerDraft["type"];

interface ScheduleFormState {
  name: string;
  prompt: string;
  sourceSessionId: string;
  target: ScheduleTarget;
  triggerType: TriggerKind;
  triggerValue: string;
  timezone: string;
  notificationPolicy: ScheduleNotificationPolicy;
}

function nextLocalHour(): string {
  const next = new Date(Date.now() + 60 * 60_000);
  next.setMinutes(0, 0, 0);
  return new Date(next.getTime() - next.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function newForm(sourceSessionId = ""): ScheduleFormState {
  return {
    name: "",
    prompt: "",
    sourceSessionId,
    target: "current_task",
    triggerType: "at",
    triggerValue: nextLocalHour(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    notificationPolicy: "always",
  };
}

export function ScheduledPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const schedules = useQuery({
    queryKey: ["schedules"],
    queryFn: () => window.backchat.schedulesList(),
    refetchInterval: 15_000,
  });
  const sessions = useQuery({
    queryKey: ["schedule-source-sessions"],
    queryFn: () => window.backchat.sessionsList(500),
    staleTime: 15_000,
  });
  const [form, setForm] = useState<ScheduleFormState>(() => newForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sourceSessions = sessions.data ?? [];
  const rows = schedules.data ?? [];
  const counts = useMemo(() => ({
    active: rows.filter((item) => item.status === "active").length,
    paused: rows.filter((item) => item.status === "paused").length,
    completed: rows.filter((item) => item.status === "completed").length,
  }), [rows]);

  const openCreate = () => {
    setEditingId(null);
    setForm(newForm(sourceSessions[0]?.id ?? ""));
    setFormOpen(true);
  };

  const openEdit = (schedule: ScheduleInfo) => {
    const triggerValue = schedule.trigger.type === "at"
      ? toLocalInput(schedule.trigger.at)
      : schedule.trigger.type === "interval"
        ? String(schedule.trigger.everyMs / 60_000)
        : schedule.trigger.type === "cron"
          ? schedule.trigger.expression
          : schedule.trigger.rule;
    const timezone = schedule.trigger.type === "cron" || schedule.trigger.type === "rrule"
      ? schedule.trigger.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setEditingId(schedule.id);
    setForm({
      name: schedule.name,
      prompt: schedule.prompt,
      sourceSessionId: schedule.sourceSessionId,
      target: schedule.target,
      triggerType: schedule.trigger.type,
      triggerValue,
      timezone,
      notificationPolicy: schedule.notificationPolicy,
    });
    setFormOpen(true);
  };

  const save = async () => {
    const source = sourceSessions.find((session) => session.id === form.sourceSessionId);
    if (!editingId && !source) {
      toast.error(t("scheduled.sourceRequired"));
      return;
    }
    setSaving(true);
    try {
      const trigger = buildScheduleTrigger({
        type: form.triggerType,
        value: form.triggerValue,
        timezone: form.timezone,
      });
      if (editingId) {
        await window.backchat.schedulesUpdate({
          id: editingId,
          name: form.name,
          prompt: form.prompt,
          trigger,
          target: form.target,
          notificationPolicy: form.notificationPolicy,
        });
      } else {
        await window.backchat.schedulesCreate({
          name: form.name,
          prompt: form.prompt,
          trigger,
          target: form.target,
          sourceSessionId: source!.id,
          agentId: source!.agent_id,
          cwd: source!.cwd,
          notificationPolicy: form.notificationPolicy,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["schedules"] });
      setFormOpen(false);
      toast.success(editingId ? t("scheduled.updated") : t("scheduled.created"));
    } catch (error) {
      toast.error(t("scheduled.saveFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (schedule: ScheduleInfo) => {
    try {
      await window.backchat.schedulesUpdate({
        id: schedule.id,
        status: schedule.status === "active" ? "paused" : "active",
      });
      await queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (error) {
      toast.error(t("scheduled.updateFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const remove = async (schedule: ScheduleInfo) => {
    if (!window.confirm(t("scheduled.deleteConfirm", { name: schedule.name }))) return;
    try {
      await window.backchat.schedulesDelete({ id: schedule.id });
      if (expandedId === schedule.id) setExpandedId(null);
      await queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (error) {
      toast.error(t("scheduled.deleteFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="h-full overflow-y-auto rounded-2xl bg-bg/80 shadow-card-soft">
      <div className="w-full px-8 pb-16 pt-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClockIcon className="size-4 text-info" aria-hidden="true" />
              <h1 className="text-base font-medium text-fg">{t("scheduled.title")}</h1>
            </div>
            <p className="mt-1 max-w-[68ch] text-[11px] leading-5 text-fg-muted">
              {t("scheduled.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void schedules.refetch()}
              disabled={schedules.isFetching}
              className="text-fg-muted"
            >
              <RefreshCwIcon className={cn("size-3.5", schedules.isFetching && "animate-spin")} />
              {t("scheduled.refresh")}
            </Button>
            <Button size="sm" onClick={openCreate} disabled={sourceSessions.length === 0}>
              <PlusIcon className="size-3.5" />
              {t("scheduled.new")}
            </Button>
          </div>
        </header>

        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-y border-border/45 py-3 text-[11px]">
          <StatusCount label={t("scheduled.active")} value={counts.active} tone="active" />
          <StatusCount label={t("scheduled.paused")} value={counts.paused} tone="paused" />
          <StatusCount label={t("scheduled.completed")} value={counts.completed} tone="completed" />
        </dl>

        {formOpen && (
          <ScheduleForm
            form={form}
            setForm={setForm}
            sessions={sourceSessions}
            editing={!!editingId}
            saving={saving}
            onCancel={() => setFormOpen(false)}
            onSave={() => void save()}
          />
        )}

        <section className="mt-5 overflow-hidden rounded-xl border border-border/55 bg-bg/72">
          {schedules.isLoading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((item) => <Skeleton key={item} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : schedules.isError ? (
            <EmptyState
              icon={<XCircleIcon className="size-5" />}
              title={t("scheduled.loadFailed")}
              description={schedules.error instanceof Error ? schedules.error.message : String(schedules.error)}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<CalendarClockIcon className="size-5" />}
              title={t("scheduled.empty")}
              description={sourceSessions.length === 0
                ? t("scheduled.emptyNoTasks")
                : t("scheduled.emptyHint")}
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {rows.map((schedule) => (
                <ScheduleRow
                  key={schedule.id}
                  schedule={schedule}
                  expanded={expandedId === schedule.id}
                  onToggleRuns={() => setExpandedId((id) => id === schedule.id ? null : schedule.id)}
                  onEdit={() => openEdit(schedule)}
                  onToggleStatus={() => void updateStatus(schedule)}
                  onDelete={() => void remove(schedule)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ScheduleForm({ form, setForm, sessions, editing, saving, onCancel, onSave }: {
  form: ScheduleFormState;
  setForm: React.Dispatch<React.SetStateAction<ScheduleFormState>>;
  sessions: PersistedSessionInfo[];
  editing: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const patch = <K extends keyof ScheduleFormState>(key: K, value: ScheduleFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const triggerHint = form.triggerType === "at"
    ? t("scheduled.atHint")
    : form.triggerType === "interval"
      ? t("scheduled.intervalHint")
      : form.triggerType === "cron"
        ? t("scheduled.cronHint")
        : t("scheduled.rruleHint");

  return (
    <section className="mt-5 rounded-xl border border-border/60 bg-bg-surface/45 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-medium text-fg">
            {editing ? t("scheduled.editTitle") : t("scheduled.createTitle")}
          </h2>
          <p className="mt-1 text-[10px] text-fg-subtle">{t("scheduled.formHint")}</p>
        </div>
        <Button variant="ghost" size="xs" onClick={onCancel}>{t("common.cancel")}</Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Field label={t("scheduled.name")}>
          <Input value={form.name} onChange={(event) => patch("name", event.target.value)} className="text-xs" />
        </Field>
        <Field label={t("scheduled.sourceTask")}>
          <select
            value={form.sourceSessionId}
            onChange={(event) => patch("sourceSessionId", event.target.value)}
            disabled={editing}
            className={selectClass}
          >
            <option value="">{t("scheduled.chooseTask")}</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title || session.id.slice(0, 8)} · {session.agent_id}
              </option>
            ))}
          </select>
        </Field>
        <div className="lg:col-span-2">
          <Field label={t("scheduled.prompt")}>
            <Textarea
              value={form.prompt}
              onChange={(event) => patch("prompt", event.target.value)}
              rows={3}
              className="min-h-20 resize-y text-xs leading-5"
            />
          </Field>
        </div>
        <Field label={t("scheduled.scheduleType")}>
          <select
            value={form.triggerType}
            onChange={(event) => {
              const type = event.target.value as TriggerKind;
              patch("triggerType", type);
              patch("triggerValue", type === "at" ? nextLocalHour() : type === "interval" ? "60" : type === "cron" ? "0 9 * * 1-5" : "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0");
            }}
            className={selectClass}
          >
            <option value="at">{t("scheduled.once")}</option>
            <option value="interval">{t("scheduled.interval")}</option>
            <option value="cron">Cron</option>
            <option value="rrule">RRULE</option>
          </select>
        </Field>
        <Field label={t("scheduled.when")} hint={triggerHint}>
          <Input
            type={form.triggerType === "at" ? "datetime-local" : form.triggerType === "interval" ? "number" : "text"}
            min={form.triggerType === "interval" ? 1 : undefined}
            value={form.triggerValue}
            onChange={(event) => patch("triggerValue", event.target.value)}
            className={cn("text-xs", (form.triggerType === "cron" || form.triggerType === "rrule") && "font-mono")}
          />
        </Field>
        {(form.triggerType === "at" || form.triggerType === "cron" || form.triggerType === "rrule") && (
          <Field label={t("scheduled.timezone")}>
            <Input value={form.timezone} onChange={(event) => patch("timezone", event.target.value)} className="font-mono text-xs" />
          </Field>
        )}
        <Field label={t("scheduled.destination")}>
          <select value={form.target} onChange={(event) => patch("target", event.target.value as ScheduleTarget)} className={selectClass}>
            <option value="current_task">{t("scheduled.currentTask")}</option>
            <option value="new_task">{t("scheduled.newTask")}</option>
          </select>
        </Field>
        <Field label={t("scheduled.notifications")}>
          <select value={form.notificationPolicy} onChange={(event) => patch("notificationPolicy", event.target.value as ScheduleNotificationPolicy)} className={selectClass}>
            <option value="always">{t("scheduled.notifyAlways")}</option>
            <option value="failures">{t("scheduled.notifyFailures")}</option>
            <option value="never">{t("scheduled.notifyNever")}</option>
          </select>
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          size="sm"
          loading={saving}
          disabled={!form.name.trim() || !form.prompt.trim() || (!editing && !form.sourceSessionId)}
          onClick={onSave}
        >
          {editing ? t("common.save") : t("scheduled.create")}
        </Button>
      </div>
    </section>
  );
}

function ScheduleRow({ schedule, expanded, onToggleRuns, onEdit, onToggleStatus, onDelete }: {
  schedule: ScheduleInfo;
  expanded: boolean;
  onToggleRuns: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const { locale, t } = useI18n();
  return (
    <li>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
        <span className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg",
          schedule.status === "active" ? "bg-info-subtle text-info" : "bg-bg-surface text-fg-subtle",
        )}>
          {schedule.status === "active" ? <Clock3Icon className="size-4" /> : schedule.status === "paused" ? <CirclePauseIcon className="size-4" /> : <CheckCircle2Icon className="size-4" />}
        </span>
        <div className="min-w-[220px] flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-xs font-medium text-fg" title={schedule.name}>{schedule.name}</h3>
            <StatusBadge status={schedule.status} />
          </div>
          <p className="mt-1 truncate text-[10px] text-fg-subtle" title={schedule.prompt}>{schedule.prompt}</p>
        </div>
        <div className="min-w-[170px] text-[10px] text-fg-muted">
          <p className="font-medium text-fg">{triggerSummary(schedule, locale)}</p>
          <p className="mt-0.5">{schedule.nextRunAt ? t("scheduled.nextRun", { date: formatDate(schedule.nextRunAt, locale) }) : t("scheduled.noNextRun")}</p>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" onClick={onToggleRuns} aria-label={t("scheduled.runs")} title={t("scheduled.runs")}> 
            <HistoryIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label={t("scheduled.editTitle")} title={t("scheduled.editTitle")}>
            <PencilIcon className="size-3.5" />
          </Button>
          {schedule.status !== "completed" && (
            <Button variant="ghost" size="icon-xs" onClick={onToggleStatus} aria-label={schedule.status === "active" ? t("scheduled.pause") : t("scheduled.resume")} title={schedule.status === "active" ? t("scheduled.pause") : t("scheduled.resume")}>
              {schedule.status === "active" ? <CirclePauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={onDelete} aria-label={t("common.remove")} title={t("common.remove")} className="text-fg-subtle hover:text-destructive">
            <Trash2Icon className="size-3.5" />
          </Button>
          <ChevronDownIcon className={cn("ml-1 size-3 text-fg-subtle transition-transform", expanded && "rotate-180")} />
        </div>
      </div>
      {expanded && <RunHistory scheduleId={schedule.id} />}
    </li>
  );
}

function RunHistory({ scheduleId }: { scheduleId: string }) {
  const { locale, t } = useI18n();
  const query = useQuery({
    queryKey: ["schedule-runs", scheduleId],
    queryFn: () => window.backchat.scheduleRunsList({ schedule_id: scheduleId }),
  });
  return (
    <div className="border-t border-border/35 bg-bg-surface/30 px-5 py-3">
      <h4 className="text-[10px] font-medium text-fg-muted">{t("scheduled.recentRuns")}</h4>
      {query.isLoading ? <Skeleton className="mt-2 h-8 w-full rounded-md" /> : !query.data?.length ? (
        <p className="mt-2 text-[10px] text-fg-subtle">{t("scheduled.noRuns")}</p>
      ) : (
        <ul className="mt-1 divide-y divide-border/30">
          {query.data.slice(0, 8).map((run) => <RunRow key={run.id} run={run} locale={locale} />)}
        </ul>
      )}
    </div>
  );
}

function RunRow({ run, locale }: { run: ScheduleRunInfo; locale: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-[10px]">
      {run.status === "succeeded" ? <CheckCircle2Icon className="size-3.5 text-success" /> : run.status === "failed" ? <XCircleIcon className="size-3.5 text-destructive" /> : <Clock3Icon className="size-3.5 text-info" />}
      <span className="font-medium text-fg">{run.status}</span>
      <span className="text-fg-subtle">{formatDate(run.startedAt, locale)}</span>
      {run.error && <span className="min-w-0 flex-1 truncate text-destructive" title={run.error}>{run.error}</span>}
      {run.sessionId && <span className="ml-auto font-mono text-fg-subtle">{run.sessionId.slice(0, 8)}</span>}
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] text-fg-muted">
      <span className="mb-1.5 block font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[9px] leading-4 text-fg-subtle">{hint}</span>}
    </label>
  );
}

function StatusBadge({ status }: { status: ScheduleInfo["status"] }) {
  const { t } = useI18n();
  return (
    <span className={cn(
      "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium",
      status === "active" ? "bg-success-subtle/70 text-success" : status === "paused" ? "bg-warning-subtle/60 text-warning" : "bg-bg-surface text-fg-subtle",
    )}>
      {t(`scheduled.${status}` as "scheduled.active")}
    </span>
  );
}

function StatusCount({ label, value, tone }: { label: string; value: number; tone: "active" | "paused" | "completed" }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-1.5 rounded-full", tone === "active" ? "bg-success" : tone === "paused" ? "bg-warning" : "bg-fg-subtle")} />
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-medium tabular-nums text-fg">{value}</dd>
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <span className="grid size-9 place-items-center rounded-lg bg-bg-surface text-fg-subtle">{icon}</span>
      <p className="mt-3 text-xs font-medium text-fg">{title}</p>
      <p className="mt-1 max-w-md text-[10px] leading-4 text-fg-muted">{description}</p>
    </div>
  );
}

function triggerSummary(schedule: ScheduleInfo, locale: string): string {
  const trigger = schedule.trigger;
  if (trigger.type === "at") return formatDate(Date.parse(trigger.at), locale);
  if (trigger.type === "interval") return `Every ${formatDuration(trigger.everyMs)}`;
  if (trigger.type === "cron") return `cron ${trigger.expression}`;
  return trigger.rule.replace(/^RRULE:/i, "");
}

function formatDuration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function formatDate(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(at));
}

function toLocalInput(source: string): string {
  const date = new Date(source);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const selectClass = "h-8 w-full rounded-lg border border-input bg-bg px-2.5 text-xs text-fg outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";
