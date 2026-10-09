import { describe, expect, it } from "vitest";
import {
  recentModelPicksForAgent,
  recordRecentModelPick,
} from "./recent-model-picks";

describe("recent-model-picks", () => {
  it("dedupes and caps MRU model values per agent", () => {
    const storage = new Map<string, string>();
    const prefs = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };

    recordRecentModelPick("codex-acp", "openai-codex-1", prefs);
    let next = recordRecentModelPick("codex-acp", "devin-0", prefs);
    next = recordRecentModelPick("codex-acp", "openai-codex-1", prefs);

    expect(recentModelPicksForAgent(next, "codex-acp")).toEqual([
      "openai-codex-1",
      "devin-0",
    ]);
  });
});
