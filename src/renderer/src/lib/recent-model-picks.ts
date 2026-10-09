import {
  parseRecentRunPreferences,
  type RecentRunPreferences,
} from "./recent-run-preferences";

export const RECENT_MODEL_PICKS_MAX = 5;

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function readPreferences(storage: PreferenceStorage): RecentRunPreferences {
  try {
    return parseRecentRunPreferences(storage.getItem("openma.recent-run-preferences.v1"));
  } catch {
    return { configByAgent: {} };
  }
}

function writePreferences(
  preferences: RecentRunPreferences,
  storage: PreferenceStorage,
) {
  try {
    storage.setItem("openma.recent-run-preferences.v1", JSON.stringify(preferences));
  } catch {
    // Selection still applies when storage is blocked.
  }
}

export function recentModelPicksForAgent(
  preferences: RecentRunPreferences,
  agentId: string,
): string[] {
  const list = preferences.recentModelsByAgent?.[agentId];
  if (!Array.isArray(list)) return [];
  return list.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function recordRecentModelPick(
  agentId: string,
  modelValue: string,
  storage: PreferenceStorage = localStorage,
): RecentRunPreferences {
  const trimmed = modelValue.trim();
  if (!agentId || !trimmed) {
    return readPreferences(storage);
  }
  const current = readPreferences(storage);
  const previous = recentModelPicksForAgent(current, agentId).filter(
    (value) => value !== trimmed,
  );
  const nextList = [trimmed, ...previous].slice(0, RECENT_MODEL_PICKS_MAX);
  const next: RecentRunPreferences = {
    ...current,
    recentModelsByAgent: {
      ...current.recentModelsByAgent,
      [agentId]: nextList,
    },
  };
  writePreferences(next, storage);
  return next;
}
