import { describe, expect, it } from "vitest";
import { extractToolOutputFiles } from "./session-artifacts";

describe("extractToolOutputFiles", () => {
  it("uses standard ACP diff, location, and file resource output", () => {
    expect(extractToolOutputFiles({
      locations: [{ path: "/work/report.csv" }],
      content: [
        { type: "diff", path: "/work/app.ts", newText: "export {}" },
        {
          type: "content",
          content: { type: "resource_link", uri: "file:///work/chart.png" },
        },
      ],
    })).toEqual([
      "/work/report.csv",
      "/work/app.ts",
      "/work/chart.png",
    ]);
  });
});
