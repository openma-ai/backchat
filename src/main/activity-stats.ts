import type { DatabaseSync } from "node:sqlite";
import type {
  ActivityDayInfo,
  ActivityStatsInfo,
  HarnessActivityInfo,
} from "../shared/api.js";

type QueryOptions = {
  now?: number;
  days?: number;
};

type NumberRow = Record<string, number>;

const DAY_MS = 86_400_000;

type HarnessRegistryMetadata = {
  id: string;
  label: string;
  icon?: string;
};

export function enrichActivityStats(
  stats: ActivityStatsInfo,
  registry: readonly HarnessRegistryMetadata[],
): ActivityStatsInfo {
  const metadataById = new Map(registry.map((agent) => [agent.id, agent]));
  return {
    ...stats,
    harnesses: stats.harnesses.map((harness) => {
      const metadata = metadataById.get(harness.harness_id);
      if (!metadata) return harness;
      return {
        ...harness,
        harness_label: metadata.label,
        ...(metadata.icon ? { icon_url: metadata.icon } : {}),
      };
    }),
  };
}

export function queryActivityStats(
  db: DatabaseSync,
  options: QueryOptions = {},
): ActivityStatsInfo {
  const now = options.now ?? Date.now();
  const days = Math.max(1, Math.floor(options.days ?? 365));
  const firstDay = addUtcDays(dayKey(now), -(days - 1));

  const sessionTotals = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN pair_id IS NULL THEN id ELSE pair_id END) AS total_tasks,
      COUNT(*) AS total_runs,
      COUNT(DISTINCT agent_id) AS total_harnesses
    FROM sessions
  `).get() as NumberRow;
  const eventTotals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'user_prompt' THEN 1 ELSE 0 END), 0) AS total_turns,
      COALESCE(SUM(CASE WHEN type = 'tool_call' THEN 1 ELSE 0 END), 0) AS total_tool_calls
    FROM events
  `).get() as NumberRow;

  const activeDayRows = db.prepare(`
    SELECT DISTINCT date(ts / 1000, 'unixepoch') AS date
    FROM events
    WHERE type = 'user_prompt'
    ORDER BY date ASC
  `).all() as Array<{ date: string }>;
  const activeDays = activeDayRows.map((row) => row.date);
  const streaks = calculateStreaks(activeDays, dayKey(now));

  const dailyTasks = db.prepare(`
    SELECT
      date(created_at / 1000, 'unixepoch') AS date,
      COUNT(DISTINCT CASE WHEN pair_id IS NULL THEN id ELSE pair_id END) AS tasks
    FROM sessions
    WHERE date(created_at / 1000, 'unixepoch') >= ?
    GROUP BY date
  `).all(firstDay) as Array<{ date: string; tasks: number }>;
  const dailyEvents = db.prepare(`
    SELECT
      date(ts / 1000, 'unixepoch') AS date,
      SUM(CASE WHEN type = 'user_prompt' THEN 1 ELSE 0 END) AS turns,
      SUM(CASE WHEN type = 'tool_call' THEN 1 ELSE 0 END) AS tool_calls
    FROM events
    WHERE date(ts / 1000, 'unixepoch') >= ?
    GROUP BY date
  `).all(firstDay) as Array<{ date: string; turns: number; tool_calls: number }>;

  const dayMap = new Map<string, ActivityDayInfo>();
  for (let offset = 0; offset < days; offset += 1) {
    const date = addUtcDays(firstDay, offset);
    dayMap.set(date, { date, tasks: 0, turns: 0, tool_calls: 0 });
  }
  for (const row of dailyTasks) {
    const day = dayMap.get(row.date);
    if (day) day.tasks = Number(row.tasks);
  }
  for (const row of dailyEvents) {
    const day = dayMap.get(row.date);
    if (!day) continue;
    day.turns = Number(row.turns);
    day.tool_calls = Number(row.tool_calls);
  }

  const harnesses = db.prepare(`
    SELECT
      s.agent_id AS harness_id,
      COUNT(DISTINCT CASE WHEN s.pair_id IS NULL THEN s.id ELSE s.pair_id END) AS tasks,
      COUNT(DISTINCT s.id) AS runs,
      SUM(CASE WHEN e.type = 'user_prompt' THEN 1 ELSE 0 END) AS turns,
      SUM(CASE WHEN e.type = 'tool_call' THEN 1 ELSE 0 END) AS tool_calls,
      COUNT(DISTINCT CASE
        WHEN e.type = 'user_prompt' THEN date(e.ts / 1000, 'unixepoch')
      END) AS active_days,
      COALESCE(
        MAX(CASE WHEN e.type IN ('user_prompt', 'tool_call') THEN e.ts END),
        MAX(s.last_used_at)
      ) AS last_active_at
    FROM sessions s
    LEFT JOIN events e ON e.session_id = s.id
    GROUP BY s.agent_id
    ORDER BY turns DESC, tool_calls DESC, tasks DESC, harness_id ASC
  `).all() as unknown as HarnessActivityInfo[];

  return {
    summary: {
      total_tasks: Number(sessionTotals["total_tasks"] ?? 0),
      total_runs: Number(sessionTotals["total_runs"] ?? 0),
      total_turns: Number(eventTotals["total_turns"] ?? 0),
      total_tool_calls: Number(eventTotals["total_tool_calls"] ?? 0),
      total_harnesses: Number(sessionTotals["total_harnesses"] ?? 0),
      active_days: activeDays.length,
      current_streak_days: streaks.current,
      longest_streak_days: streaks.longest,
    },
    daily: [...dayMap.values()],
    harnesses: harnesses.map((row) => ({
      harness_id: row.harness_id,
      tasks: Number(row.tasks),
      runs: Number(row.runs),
      turns: Number(row.turns),
      tool_calls: Number(row.tool_calls),
      active_days: Number(row.active_days),
      last_active_at: Number(row.last_active_at),
    })),
  };
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addUtcDays(date: string, amount: number): string {
  return dayKey(Date.parse(`${date}T00:00:00Z`) + amount * DAY_MS);
}

function calculateStreaks(
  orderedDays: readonly string[],
  today: string,
): { current: number; longest: number } {
  if (orderedDays.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let index = 1; index < orderedDays.length; index += 1) {
    const previous = orderedDays[index - 1];
    const current = orderedDays[index];
    if (previous && current && addUtcDays(previous, 1) === current) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
  }

  const active = new Set(orderedDays);
  let cursor = active.has(today) ? today : addUtcDays(today, -1);
  let current = 0;
  while (active.has(cursor)) {
    current += 1;
    cursor = addUtcDays(cursor, -1);
  }
  return { current, longest };
}
