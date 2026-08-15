import type { ScheduleInfo, ScheduleTrigger } from "@shared/schedules.js";

export {
  parseScheduledTaskPrompt,
  wrapScheduledTaskPrompt,
} from "@shared/scheduled-task-prompt.js";
export type { ScheduledTaskPromptSurface } from "@shared/scheduled-task-prompt.js";

export const SCHEDULES_QUERY_KEY = ["schedules"] as const;

export interface ScheduleCreateSurface {
  id?: string;
  name: string;
  trigger?: ScheduleTrigger;
  prompt?: string;
}

export interface ScheduleToolLike {
  title?: string;
  toolName?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: Array<{
    type?: string;
    content?: { type?: string; text?: string };
  }>;
}

export function scheduledSourceSessionIds(
  schedules: readonly ScheduleInfo[],
): Set<string> {
  return new Set(
    liveSchedulesForSessions(
      schedules,
      schedules.map((schedule) => schedule.sourceSessionId),
    ).map((schedule) => schedule.sourceSessionId),
  );
}

export function liveSchedulesForSessions(
  schedules: readonly ScheduleInfo[],
  sessionIds: readonly string[],
): ScheduleInfo[] {
  const ids = new Set(sessionIds);
  return schedules.filter(
    (schedule) => ids.has(schedule.sourceSessionId) && schedule.status !== "completed",
  );
}

export function visibleSchedulePageRows(
  schedules: readonly ScheduleInfo[],
): ScheduleInfo[] {
  return schedules.filter((schedule) => schedule.status !== "completed");
}

export type SchedulePageTab = "all" | "active" | "paused";

export function scheduleRowsForTab(
  schedules: readonly ScheduleInfo[],
  tab: SchedulePageTab,
): ScheduleInfo[] {
  const live = visibleSchedulePageRows(schedules);
  if (tab === "all") return live;
  return live.filter((schedule) => schedule.status === tab);
}

export function formatScheduleListMeta(
  schedule: Pick<ScheduleInfo, "trigger" | "nextRunAt">,
  locale: string,
  now = Date.now(),
): string {
  const frequency = formatScheduleFrequency(schedule.trigger, locale);
  if (schedule.nextRunAt == null) return frequency;
  return `${frequency} · ${formatNextRunPhrase(schedule.nextRunAt, locale, now)}`;
}

function formatNextRunPhrase(nextRunAt: number, locale: string, now: number): string {
  const delta = nextRunAt - now;
  const zh = locale.startsWith("zh");
  if (delta <= 0) return zh ? "即将运行" : "Due now";
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) {
    return zh
      ? `${minutes} 分钟后运行`
      : `Next run in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return zh
      ? `${hours} 小时后运行`
      : `Next run in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return zh
    ? `${days} 天后运行`
    : `Next run in ${days} day${days === 1 ? "" : "s"}`;
}

export function scheduleArchiveCopyKind(
  sessionCount: number,
  taskCount: number,
): "task" | "tasks" | "chats" {
  if (sessionCount > 1) return "chats";
  return taskCount > 1 ? "tasks" : "task";
}

export function formatListedTaskNames(
  names: readonly string[],
  locale: string,
): string {
  return names.join(locale.startsWith("zh") ? "、" : ", ");
}

export function scheduleSourceSessionLabel(
  sessions: readonly { id: string; title?: string }[],
  sessionId: string,
): string {
  const title = sessions.find((session) => session.id === sessionId)?.title?.trim();
  return title || sessionId.slice(0, 8);
}

export function isScheduleCreateTool(tool: ScheduleToolLike): boolean {
  const haystack = `${tool.toolName ?? ""} ${tool.title ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return haystack.includes("schedulecreate") || haystack.includes("createschedule");
}

export function schedulesCreatedByTools(
  tools: readonly ScheduleToolLike[],
): ScheduleCreateSurface[] {
  const created: ScheduleCreateSurface[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (!isScheduleCreateTool(tool) || tool.status === "failed") continue;
    const surface = scheduleSurfaceFromTool(tool);
    if (!surface) continue;
    const key = surface.id ?? surface.name;
    if (seen.has(key)) continue;
    seen.add(key);
    created.push(surface);
  }
  return created;
}

export function formatScheduleFrequency(
  trigger: ScheduleTrigger,
  locale: string,
): string {
  if (trigger.type === "interval") {
    const minutes = Math.max(1, Math.round(trigger.everyMs / 60_000));
    if (minutes === 1) return locale.startsWith("zh") ? "每分钟" : "Every minute";
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      if (hours === 1) return locale.startsWith("zh") ? "每小时" : "Every hour";
      return locale.startsWith("zh") ? `每 ${hours} 小时` : `Every ${hours} hours`;
    }
    return locale.startsWith("zh") ? `每 ${minutes} 分钟` : `Every ${minutes} minutes`;
  }
  if (trigger.type === "at") {
    const at = Date.parse(trigger.at);
    if (Number.isFinite(at)) {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(at);
    }
    return trigger.at;
  }
  if (trigger.type === "cron") return `cron ${trigger.expression}`;
  return formatRrule(trigger.rule, locale);
}

function formatRrule(rule: string, locale: string): string {
  const raw = rule.replace(/^RRULE:/i, "");
  const parts = Object.fromEntries(
    raw.split(";").flatMap((piece) => {
      const [key, value] = piece.split("=");
      return key && value ? [[key.toUpperCase(), value]] : [];
    }),
  );
  if (parts.FREQ === "DAILY" && parts.BYHOUR != null) {
    const hour = Number(parts.BYHOUR.split(",")[0]);
    const minute = Number((parts.BYMINUTE ?? "0").split(",")[0]);
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      const time = new Date(Date.UTC(2020, 0, 1, hour, minute)).toLocaleTimeString(
        locale,
        { hour: "numeric", minute: "2-digit", timeZone: "UTC" },
      );
      return locale.startsWith("zh") ? `每天 ${time}` : `Daily at ${time}`;
    }
  }
  return raw;
}

function scheduleSurfaceFromTool(tool: ScheduleToolLike): ScheduleCreateSurface | null {
  const fromOutput = scheduleSurfaceFromUnknown(tool.rawOutput)
    ?? scheduleSurfaceFromUnknown(textFromToolContent(tool));
  const fromInput = scheduleSurfaceFromUnknown(tool.rawInput);
  if (!fromOutput && !fromInput) return null;
  const name = fromOutput?.name || fromInput?.name;
  if (!name) return null;
  return {
    ...(fromOutput?.id ? { id: fromOutput.id } : {}),
    name,
    ...(fromOutput?.trigger ?? fromInput?.trigger
      ? { trigger: fromOutput?.trigger ?? fromInput?.trigger }
      : {}),
    ...(fromOutput?.prompt ?? fromInput?.prompt
      ? { prompt: fromOutput?.prompt ?? fromInput?.prompt }
      : {}),
  };
}

function textFromToolContent(tool: ScheduleToolLike): string | undefined {
  for (const block of tool.content ?? []) {
    if (block.content?.type === "text" && typeof block.content.text === "string") {
      return block.content.text;
    }
  }
  return undefined;
}

function scheduleSurfaceFromUnknown(value: unknown): ScheduleCreateSurface | null {
  const record = parseRecord(value);
  if (!record) return null;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return null;
  const trigger = parseTrigger(record.trigger);
  return {
    ...(typeof record.id === "string" && record.id ? { id: record.id } : {}),
    name,
    ...(trigger ? { trigger } : {}),
    ...(typeof record.prompt === "string" ? { prompt: record.prompt } : {}),
  };
}

function parseTrigger(value: unknown): ScheduleTrigger | undefined {
  const record = parseRecord(value);
  if (!record || typeof record.type !== "string") return undefined;
  if (record.type === "at" && typeof record.at === "string") {
    return { type: "at", at: record.at };
  }
  if (record.type === "interval" && typeof record.everyMs === "number") {
    return { type: "interval", everyMs: record.everyMs };
  }
  if (
    record.type === "cron"
    && typeof record.expression === "string"
    && typeof record.timezone === "string"
  ) {
    return {
      type: "cron",
      expression: record.expression,
      timezone: record.timezone,
    };
  }
  if (
    record.type === "rrule"
    && typeof record.rule === "string"
    && typeof record.timezone === "string"
  ) {
    return { type: "rrule", rule: record.rule, timezone: record.timezone };
  }
  return undefined;
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return parseRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
