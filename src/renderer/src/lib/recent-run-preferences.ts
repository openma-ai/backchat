import {
  flattenSelectOptions,
  type AcpSessionConfigOption,
} from "./session-config-options";

export const RECENT_RUN_PREFERENCES_KEY = "openma.recent-run-preferences.v1";

export type RunConfigValue = string | boolean;

export interface RecentRunPreferences {
  agentId?: string;
  configByAgent: Record<string, Record<string, RunConfigValue>>;
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const EMPTY_PREFERENCES: RecentRunPreferences = {
  configByAgent: {},
};

export function parseRecentRunPreferences(
  raw: string | null,
): RecentRunPreferences {
  if (!raw) return { ...EMPTY_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { ...EMPTY_PREFERENCES };
    }
    const candidate = parsed as Record<string, unknown>;
    const agentId =
      typeof candidate.agentId === "string" && candidate.agentId.trim()
        ? candidate.agentId.trim()
        : undefined;
    const configByAgent: RecentRunPreferences["configByAgent"] = {};
    if (candidate.configByAgent && typeof candidate.configByAgent === "object") {
      for (const [id, rawValues] of Object.entries(
        candidate.configByAgent as Record<string, unknown>,
      )) {
        if (!rawValues || typeof rawValues !== "object") continue;
        const values: Record<string, RunConfigValue> = {};
        for (const [configId, value] of Object.entries(
          rawValues as Record<string, unknown>,
        )) {
          if (typeof value === "string" || typeof value === "boolean") {
            values[configId] = value;
          }
        }
        configByAgent[id] = values;
      }
    }
    return {
      ...(agentId ? { agentId } : {}),
      configByAgent,
    };
  } catch {
    return { ...EMPTY_PREFERENCES };
  }
}

export function readRecentRunPreferences(
  storage: PreferenceStorage = localStorage,
): RecentRunPreferences {
  try {
    return parseRecentRunPreferences(
      storage.getItem(RECENT_RUN_PREFERENCES_KEY),
    );
  } catch {
    return { ...EMPTY_PREFERENCES };
  }
}

export function recentConfigOverrides(
  preferences: RecentRunPreferences,
  agentId: string,
  options: readonly AcpSessionConfigOption[] | undefined,
): Record<string, RunConfigValue> {
  const recent = preferences.configByAgent[agentId];
  if (!recent || !options?.length) return {};
  const restored: Record<string, RunConfigValue> = {};
  for (const option of options) {
    const value = recent[option.id];
    if (option.type === "boolean" && typeof value === "boolean") {
      restored[option.id] = value;
      continue;
    }
    if (
      option.type === "select"
      && typeof value === "string"
      && flattenSelectOptions(option).some((item) => item.value === value)
    ) {
      restored[option.id] = value;
    }
  }
  return restored;
}

export function configValuesFromOptions(
  options: readonly AcpSessionConfigOption[] | undefined,
): Record<string, RunConfigValue> {
  return Object.fromEntries(
    (options ?? []).map((option) => [option.id, option.currentValue]),
  );
}

export function recordRecentRunPreferences(
  input: {
    agentId: string;
    configValues: Record<string, RunConfigValue>;
  },
  storage: PreferenceStorage = localStorage,
): RecentRunPreferences {
  const current = readRecentRunPreferences(storage);
  const next: RecentRunPreferences = {
    agentId: input.agentId,
    configByAgent: {
      ...current.configByAgent,
      [input.agentId]: {
        ...current.configByAgent[input.agentId],
        ...input.configValues,
      },
    },
  };
  try {
    storage.setItem(RECENT_RUN_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // The selection still works for this render even when storage is blocked.
  }
  return next;
}
