import { describe, expect, it } from "vitest";

import { buildScheduleTrigger } from "./scheduled-page-model.js";

describe("buildScheduleTrigger", () => {
  it("turns a local one-time value into an offset-aware timestamp", () => {
    expect(buildScheduleTrigger({
      type: "at",
      value: "2026-07-20T10:00",
      timezone: "Asia/Shanghai",
    })).toEqual({
      type: "at",
      at: "2026-07-20T02:00:00.000Z",
    });
  });

  it("turns an interval in minutes into milliseconds", () => {
    expect(buildScheduleTrigger({
      type: "interval",
      value: "15",
      timezone: "Asia/Shanghai",
    })).toEqual({ type: "interval", everyMs: 900_000 });
  });

  it("keeps a cron expression paired with its timezone", () => {
    expect(buildScheduleTrigger({
      type: "cron",
      value: "0 10 * * 1-5",
      timezone: "Asia/Shanghai",
    })).toEqual({
      type: "cron",
      expression: "0 10 * * 1-5",
      timezone: "Asia/Shanghai",
    });
  });

  it("keeps an RRULE paired with its timezone", () => {
    expect(buildScheduleTrigger({
      type: "rrule",
      value: "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0",
      timezone: "Asia/Shanghai",
    })).toEqual({
      type: "rrule",
      rule: "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0",
      timezone: "Asia/Shanghai",
    });
  });
});
