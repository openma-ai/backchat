import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  CirclePauseIcon,
  Clock3Icon,
  ChevronDownIcon,
  HistoryIcon,
  MessageCircleIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
  XCircleIcon,
} from "@/components/Icons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentPage, PageScaffold } from "@/components/shell/PageScaffold";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";
import { enabledAgentIds, isAgentRunnable } from "@/lib/enabled-agents";
import { useProjects } from "@/lib/projects-query";
import { useSettings } from "@/lib/settings-store";
import { sessionStore } from "@/lib/session-store";
import {
  SCHEDULES_QUERY_KEY,
  formatScheduleListMeta,
  scheduleRowsForTab,
  scheduleSourceSessionLabel,
  type SchedulePageTab,
} from "@/lib/scheduled-task-presentation";
import { buildScheduleTrigger, type ScheduleTriggerDraft } from "@/lib/scheduled-page-model";
import type {
  ScheduleInfo,
  ScheduleNotificationPolicy,
  ScheduleRunInfo,
  ScheduleTarget,
} from "@shared/schedules.js";
import type { PersistedSessionInfo } from "@shared/api.js";
import type { AgentInfo } from "@shared/api.js";
import type { ProjectInfo } from "@shared/projects.js";

type TriggerKind = ScheduleTriggerDraft["type"];

interface ScheduleFormState {
  name: string;
  prompt: string;
  sourceSessionId: string;
  agentId: string;
  cwd: string;
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
    agentId: "",
    cwd: "",
    target: sourceSessionId ? "current_task" : "new_task",
    triggerType: "at",
    triggerValue: nextLocalHour(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    notificationPolicy: "always",
  };
}

const SCHEDULE_TABS: { id: SchedulePageTab; label: TranslationKey }[] = [
  { id: "all", label: "scheduled.all" },
  { id: "active", label: "scheduled.active" },
  { id: "paused", label: "scheduled.paused" },
];

export function ScheduledPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const schedules = useQuery({
    queryKey: SCHEDULES_QUERY_KEY,
    queryFn: () => window.backchat.schedulesList(),
    refetchInterval: 15_000,
  });
  const sessions = useQuery({
    queryKey: ["schedule-source-sessions"],
    queryFn: () => window.backchat.sessionsList(500),
    staleTime: 15_000,
  });
  const agents = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: () => window.backchat.agentsList(),
  });
  const projects = useProjects();
  const settings = useSettings();
  const enabledIds = enabledAgentIds(settings);
  const availableAgents = (agents.data ?? []).filter((agent) => enabledIds.has(agent.id) && isAgentRunnable(agent));
  const [form, setForm] = useState<ScheduleFormState>(() => newForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<SchedulePageTab>("all");
  const [search, setSearch] = useState("");

  const sourceSessions = sessions.data ?? [];
  const rows = scheduleRowsForTab(schedules.data ?? [], tab).filter((schedule) =>
    `${schedule.name} ${schedule.prompt}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(newForm());
    setFormOpen(true);
  };

  const createWithCodex = () => {
    window.sessionStorage.setItem("backchat.schedule-setup-prompt", t("scheduled.codexPrompt"));
    sessionStore.newDraft();
    void navigate({ to: "/" });
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
      agentId: schedule.agentId,
      cwd: schedule.cwd,
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
    if (!editingId && form.sourceSessionId && !source) {
      toast.error(t("scheduled.sourceRequired"));
      return;
    }
    if (!editingId && !source && !availableAgents.some((agent) => agent.id === form.agentId)) {
      toast.error(t("scheduled.agentRequired"));
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
          sourceSessionId: source?.id ?? "",
          agentId: source?.agent_id ?? form.agentId,
          cwd: source?.cwd ?? form.cwd,
          notificationPolicy: form.notificationPolicy,
        });
      }
      await queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
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
      await queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
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
      await queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    } catch (error) {
      toast.error(t("scheduled.deleteFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <ContentPage>
      <PageScaffold
        className={formOpen ? "max-w-[1240px]" : undefined}
        title={t("scheduled.title")}
        description={t("scheduled.description")}
        actions={(
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void schedules.refetch()}
              disabled={schedules.isFetching}
              aria-label={t("scheduled.refresh")}
              title={t("scheduled.refresh")}
              className="text-fg-muted"
            >
              <RefreshCwIcon className={cn("size-3.5", schedules.isFetching && "animate-spin")} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" aria-label={t("scheduled.new")}>
                  {t("scheduled.new")}
                  <ChevronDownIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onSelect={createWithCodex}>
                  <MessageCircleIcon className="size-4" />
                  {t("scheduled.createWithCodex")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openCreate}>
                  <PencilIcon className="size-4" />
                  {t("scheduled.setUpManually")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      >
        <div className={cn(formOpen && "grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
          <div className="min-w-0">
            <div role="tablist" aria-label={t("scheduled.title")} className="flex gap-5">
              {SCHEDULE_TABS.map((item) => {
                const selected = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "relative pb-2 text-[13px] transition-colors",
                      selected ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {t(item.label)}
                    {selected && (
                      <span className="absolute inset-x-0 bottom-0 h-px bg-fg" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="relative mt-5">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("scheduled.search")}
                aria-label={t("scheduled.search")}
                className="pl-9 text-sm"
              />
            </div>
            <section className="mt-4">
              {schedules.isLoading ? (
                <div className="space-y-3 py-4">
                  {[0, 1, 2].map((item) => <Skeleton key={item} className="h-14 w-full rounded-lg" />)}
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
                  title={t(search.trim() ? "scheduled.noSearchResults" : "scheduled.empty")}
                  description={search.trim() ? "" : t("scheduled.emptyHint")}
                />
              ) : (
                <ul className="mt-1">
                  {rows.map((schedule) => (
                    <ScheduleRow
                      key={schedule.id}
                      schedule={schedule}
                      sourceLabel={schedule.sourceSessionId
                        ? scheduleSourceSessionLabel(sourceSessions, schedule.sourceSessionId)
                        : t("scheduled.noSourceTask")}
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
          {formOpen && (
            <ScheduleForm
              form={form}
              setForm={setForm}
              sessions={sourceSessions}
              agents={availableAgents}
              projects={projects.data ?? []}
              editing={!!editingId}
              saving={saving}
              onCancel={() => setFormOpen(false)}
              onSave={() => void save()}
            />
          )}
        </div>
      </PageScaffold>
    </ContentPage>
  );
}

function ScheduleForm({ form, setForm, sessions, agents, projects, editing, saving, onCancel, onSave }: {
  form: ScheduleFormState;
  setForm: React.Dispatch<React.SetStateAction<ScheduleFormState>>;
  sessions: PersistedSessionInfo[];
  agents: AgentInfo[];
  projects: ProjectInfo[];
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
    <section className="min-w-0 border-t border-border/60 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium text-fg">
          {editing ? t("scheduled.editTitle") : t("scheduled.createTitle")}
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label={t("common.close")}>
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="mt-6 grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t("scheduled.name")}>
            <Input value={form.name} onChange={(event) => patch("name", event.target.value)} className="text-sm" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("scheduled.prompt")}>
            <Textarea
              value={form.prompt}
              onChange={(event) => patch("prompt", event.target.value)}
              rows={3}
              className="min-h-24 resize-y text-sm leading-5"
            />
          </Field>
        </div>
        {(sessions.length > 0 || !!form.sourceSessionId) && (
          <div className="sm:col-span-2">
            <Field label={t("scheduled.sourceTask")}>
              <select
                value={form.sourceSessionId}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  sourceSessionId: event.target.value,
                  target: event.target.value
                    ? current.sourceSessionId ? current.target : "current_task"
                    : "new_task",
                }))}
                disabled={editing}
                className={selectClass}
              >
                <option value="">{t("scheduled.noSourceTask")}</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title || session.id.slice(0, 8)} · {session.agent_id}
                  </option>
                ))}
                {form.sourceSessionId && !sessions.some((session) => session.id === form.sourceSessionId) && (
                  <option value={form.sourceSessionId}>{form.sourceSessionId.slice(0, 8)}</option>
                )}
              </select>
            </Field>
          </div>
        )}
        {!form.sourceSessionId && (
          <>
            <div>
              <Field label={t("scheduled.agent")}>
                <select value={form.agentId} onChange={(event) => patch("agentId", event.target.value)} disabled={editing} className={selectClass}>
                  <option value="">{t("scheduled.chooseAgent")}</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
                </select>
              </Field>
              {!editing && agents.length === 0 && <Link to="/settings/agents" className="mt-2 inline-block text-xs text-fg-muted underline">{t("scheduled.configureAgent")}</Link>}
            </div>
            <Field label={t("scheduled.project")}>
              <select value={form.cwd} onChange={(event) => patch("cwd", event.target.value)} disabled={editing} className={selectClass}>
                <option value="">{t("scheduled.noProject")}</option>
                {projects.filter((project) => project.primary_folder).map((project) => (
                  <option key={project.id} value={project.primary_folder}>{project.name}</option>
                ))}
              </select>
            </Field>
          </>
        )}
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
            className={cn("text-sm", (form.triggerType === "cron" || form.triggerType === "rrule") && "font-mono")}
          />
        </Field>
        {(form.triggerType === "cron" || form.triggerType === "rrule") && (
          <Field label={t("scheduled.timezone")}>
            <Input value={form.timezone} onChange={(event) => patch("timezone", event.target.value)} className="font-mono text-sm" />
          </Field>
        )}
        {form.sourceSessionId && <Field label={t("scheduled.destination")}>
          <select value={form.target} onChange={(event) => patch("target", event.target.value as ScheduleTarget)} className={selectClass}>
            <option value="current_task">{t("scheduled.currentTask")}</option>
            <option value="new_task">{t("scheduled.newTask")}</option>
          </select>
        </Field>}
        <div className="sm:col-span-2">
          <Field label={t("scheduled.notifications")}>
            <select value={form.notificationPolicy} onChange={(event) => patch("notificationPolicy", event.target.value as ScheduleNotificationPolicy)} className={selectClass}>
              <option value="always">{t("scheduled.notifyAlways")}</option>
              <option value="failures">{t("scheduled.notifyFailures")}</option>
              <option value="never">{t("scheduled.notifyNever")}</option>
            </select>
          </Field>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          size="sm"
          loading={saving}
          disabled={!form.name.trim() || !form.prompt.trim() || (!editing && !form.sourceSessionId && !agents.some((agent) => agent.id === form.agentId))}
          onClick={onSave}
        >
          {editing ? t("common.save") : t("scheduled.create")}
        </Button>
      </div>
    </section>
  );
}

function ScheduleRow({ schedule, sourceLabel, expanded, onToggleRuns, onEdit, onToggleStatus, onDelete }: {
  schedule: ScheduleInfo;
  sourceLabel: string;
  expanded: boolean;
  onToggleRuns: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const { locale, t } = useI18n();
  const meta = formatScheduleListMeta(schedule, locale);
  return (
    <li className="group">
      <div className="flex items-start gap-3 rounded-lg px-1.5 py-3 hover:bg-bg-surface/55">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-bg-surface text-fg-muted">
          {schedule.status === "paused"
            ? <CirclePauseIcon className="size-3.5" />
            : <Clock3Icon className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          {schedule.sourceSessionId ? <Link
            to="/chat/$sessionId"
            params={{ sessionId: schedule.sourceSessionId }}
            aria-label={t("scheduled.openSource")}
            title={sourceLabel}
            className="block min-w-0"
          >
            <span className="block truncate text-[13px] font-medium text-fg" title={schedule.name}>
              {schedule.name}
            </span>
          </Link> : <span className="block truncate text-[13px] font-medium text-fg" title={schedule.name}>{schedule.name}</span>}
          <button
            type="button"
            onClick={onToggleRuns}
            className="block w-full min-w-0 text-left"
          >
            <span className="mt-0.5 block truncate text-[11px] text-fg-muted" title={meta}>
              {meta}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-fg-subtle" title={schedule.prompt}>
              {schedule.prompt}
            </span>
          </button>
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 pt-0.5 transition-opacity",
            expanded ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <Button variant="ghost" size="icon-xs" onClick={onToggleRuns} aria-label={t("scheduled.runs")} title={t("scheduled.runs")}>
            <HistoryIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label={t("scheduled.editTitle")} title={t("scheduled.editTitle")}>
            <PencilIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onToggleStatus}
            aria-label={schedule.status === "active" ? t("scheduled.pause") : t("scheduled.resume")}
            title={schedule.status === "active" ? t("scheduled.pause") : t("scheduled.resume")}
          >
            {schedule.status === "active" ? <CirclePauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onDelete} aria-label={t("common.remove")} title={t("common.remove")} className="text-fg-subtle hover:text-destructive">
            <Trash2Icon className="size-3.5" />
          </Button>
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
    <div className="ml-11 rounded-lg bg-bg-surface/40 px-3 py-3">
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
    <label className="block text-xs text-fg-muted">
      <span className="mb-2 block font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-4 text-fg-muted">{hint}</span>}
    </label>
  );
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
      <span className="grid size-9 place-items-center rounded-full bg-bg-surface text-fg-subtle">{icon}</span>
      <p className="mt-3 text-xs font-medium text-fg">{title}</p>
      <p className="mt-1 max-w-md text-[11px] leading-4 text-fg-muted">{description}</p>
    </div>
  );
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

const selectClass = "h-9 w-full rounded-lg border border-input bg-bg px-2.5 text-sm text-fg outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";
