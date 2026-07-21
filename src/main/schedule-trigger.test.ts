import { describe, expect, it } from "vitest";

import { nextScheduleRun } from "./schedule-trigger.js";

describe("nextScheduleRun", () => {
  it("returns the future instant for a one-time schedule", () => {
    const now = Date.parse("2026-07-19T09:00:00.000Z");

    expect(
      nextScheduleRun(
        { type: "at", at: "2026-07-20T10:00:00+08:00" },
        now,
      ),
    ).toBe(Date.parse("2026-07-20T02:00:00.000Z"));
  });

  it("returns the next interval boundary", () => {
    const now = Date.parse("2026-07-19T09:00:45.000Z");

    expect(
      nextScheduleRun(
        { type: "interval", everyMs: 60_000 } as never,
        now,
        Date.parse("2026-07-19T09:00:00.000Z"),
      ),
    ).toBe(Date.parse("2026-07-19T09:01:00.000Z"));
  });

  it("resolves a five-field cron expression in its timezone", () => {
    const now = Date.parse("2026-07-19T01:00:00.000Z");

    expect(
      nextScheduleRun(
        {
          type: "cron",
          expression: "0 10 * * 1-5",
          timezone: "Asia/Shanghai",
        },
        now,
      ),
    ).toBe(Date.parse("2026-07-20T02:00:00.000Z"));
  });

  it("finds sparse cron occurrences more than a year away", () => {
    const now = Date.parse("2026-07-19T01:00:00.000Z");

    expect(
      nextScheduleRun(
        {
          type: "cron",
          expression: "0 9 29 2 *",
          timezone: "Asia/Shanghai",
        },
        now,
      ),
    ).toBe(Date.parse("2028-02-29T01:00:00.000Z"));
  });

  it("resolves an RFC 5545 monthly rule", () => {
    const now = Date.parse("2026-06-14T00:00:00.000Z");

    expect(
      nextScheduleRun(
        {
          type: "rrule",
          rule: "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0",
          timezone: "Asia/Shanghai",
        },
        now,
      ),
    ).toBe(Date.parse("2026-07-01T01:00:00.000Z"));
  });
});
