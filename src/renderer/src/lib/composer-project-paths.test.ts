import { describe, expect, it } from "vitest";
import { selectRecentProjectPaths } from "./composer-project-paths";

describe("selectRecentProjectPaths", () => {
  it("keeps recent project order while trimming, deduplicating, and filtering session folders", () => {
    expect(
      selectRecentProjectPaths([
        { cwd: " /Users/mini/work/openma " },
        { cwd: "/Users/mini/work/openma" },
        { cwd: "/Users/mini/.openma/sessions/sess-managed" },
        { cwd: String.raw`C:\Users\mini\.openma\sessions\sess-managed` },
        { cwd: "" },
        { cwd: null },
        { cwd: "/Users/mini/work/second" },
      ]),
    ).toEqual([
      "/Users/mini/work/openma",
      "/Users/mini/work/second",
    ]);
  });

  it("limits the result without reordering the persisted rows", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      cwd: `/Users/mini/work/project-${index + 1}`,
    }));

    expect(selectRecentProjectPaths(rows, 3)).toEqual([
      "/Users/mini/work/project-1",
      "/Users/mini/work/project-2",
      "/Users/mini/work/project-3",
    ]);
  });
});
