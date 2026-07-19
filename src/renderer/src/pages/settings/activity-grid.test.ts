import { describe, expect, it } from "vitest";
import { buildActivityGrid, activityLevel, formatUnitCount } from "./activity-grid";

describe("activity grid", () => {
  it("aligns UTC activity days into Sunday-first weeks", () => {
    const grid = buildActivityGrid([
      { date: "2026-07-13", tasks: 1, turns: 2, tool_calls: 0 },
      { date: "2026-07-14", tasks: 0, turns: 1, tool_calls: 1 },
      { date: "2026-07-15", tasks: 0, turns: 4, tool_calls: 2 },
    ], "turns");

    expect(grid.weeks).toHaveLength(1);
    expect(grid.weeks[0]?.map((cell) => cell?.date ?? null)).toEqual([
      null,
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      null,
      null,
      null,
    ]);
    expect(grid.max).toBe(4);
  });

  it("keeps zero activity neutral and maps non-zero values to four intensity levels", () => {
    expect([0, 1, 3, 6, 8].map((value) => activityLevel(value, 8))).toEqual([
      0,
      1,
      2,
      3,
      4,
    ]);
  });

  it("uses the singular unit only for one", () => {
    expect(formatUnitCount(1, "day", "days")).toBe("1 day");
    expect(formatUnitCount(2, "day", "days")).toBe("2 days");
  });
});
