import { describe, expect, it } from "vitest";

import {
  shouldShowTransientThought,
  turnWorkDurationSeconds,
} from "./turn-presentation";

describe("shouldShowTransientThought", () => {
  it("shows thought only before visible streaming content arrives", () => {
    expect(
      shouldShowTransientThought({
        isStreaming: true,
        thoughtText: "Inspecting the repository",
        hasVisibleContent: false,
      }),
    ).toBe(true);
    expect(
      shouldShowTransientThought({
        isStreaming: true,
        thoughtText: "Inspecting the repository",
        hasVisibleContent: true,
      }),
    ).toBe(false);
    expect(
      shouldShowTransientThought({
        isStreaming: false,
        thoughtText: "Inspecting the repository",
        hasVisibleContent: false,
      }),
    ).toBe(false);
  });
});

describe("turnWorkDurationSeconds", () => {
  it("rounds elapsed work up to a whole second", () => {
    expect(
      turnWorkDurationSeconds({
        startedAt: 1_000,
        endedAt: 2_001,
        events: [],
      }),
    ).toBe(2);
  });

  it("uses the latest event while a turn has no end timestamp", () => {
    expect(
      turnWorkDurationSeconds({
        startedAt: 1_000,
        events: [
          { payload: {}, receivedAt: 1_400 },
          { payload: {}, receivedAt: 2_500 },
        ],
      }),
    ).toBe(2);
  });
});
