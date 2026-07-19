import type { ActivityDayInfo } from "@shared/api";

export type ActivityMetric = "tasks" | "turns" | "tool_calls";
export type ActivityCell = ActivityDayInfo & { value: number };

export function buildActivityGrid(
  days: readonly ActivityDayInfo[],
  metric: ActivityMetric,
): { weeks: Array<Array<ActivityCell | null>>; max: number } {
  if (days.length === 0) return { weeks: [], max: 0 };

  const cells: Array<ActivityCell | null> = [];
  const first = days[0];
  if (!first) return { weeks: [], max: 0 };
  const leading = new Date(`${first.date}T00:00:00Z`).getUTCDay();
  for (let index = 0; index < leading; index += 1) cells.push(null);

  let max = 0;
  for (const day of days) {
    const value = day[metric];
    max = Math.max(max, value);
    cells.push({ ...day, value });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<ActivityCell | null>> = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return { weeks, max };
}

export function activityLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function formatUnitCount(
  value: number,
  singular: string,
  plural: string,
): string {
  return `${value} ${value === 1 ? singular : plural}`;
}
