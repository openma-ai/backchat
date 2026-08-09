import { describe, expect, it } from "vitest";

import { elapsedSecondsFor, formatElapsed } from "./elapsed-clock";

describe("elapsed time on a progress row", () => {
  it("stays readable past a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59.4)).toBe("59s");
    expect(formatElapsed(1414)).toBe("23m 34s");
    expect(formatElapsed(3600)).toBe("1h 0m");
  });

  it("uses the wall clock when the agent charges no worked time", () => {
    // Codex reported timeUsedSeconds: 0 for a goal set half an hour earlier.
    expect(elapsedSecondsFor(0, 1_000_000, 1_060_000)).toBe(60);
  });

  it("keeps moving even when the agent reported a total", () => {
    // A reported number cannot advance between snapshots, so a known start time
    // wins; otherwise the row freezes at whatever the last snapshot said.
    expect(elapsedSecondsFor(12, 1_000_000, 1_060_000)).toBe(60);
    expect(elapsedSecondsFor(12, undefined, 1_060_000)).toBe(12);
  });

  it("has nothing to show without either", () => {
    expect(elapsedSecondsFor(undefined, undefined, 1)).toBeUndefined();
  });
});
