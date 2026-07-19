import { describe, expect, it } from "vitest";
import { folderName, isPerSessionFolderPath } from "./project-path";

describe("isPerSessionFolderPath", () => {
  it("recognizes auto-allocated session folders on POSIX and Windows", () => {
    expect(
      isPerSessionFolderPath("/Users/minimax/.openma/sessions/sess-rfwr779u"),
    ).toBe(true);
    expect(
      isPerSessionFolderPath(
        String.raw`C:\Users\mini\.openma\sessions\sess-rfwr779u`,
      ),
    ).toBe(true);
  });

  it("keeps ordinary project folders", () => {
    expect(isPerSessionFolderPath("/Users/minimax/oos-proj/openma")).toBe(false);
    expect(isPerSessionFolderPath("/Users/minimax/projects/sessions-ui")).toBe(
      false,
    );
    expect(isPerSessionFolderPath("/Users/minimax/projects/sess-client")).toBe(
      false,
    );
  });
});

describe("folderName", () => {
  it("shows only the final folder segment for project labels", () => {
    expect(folderName("/Users/minimax/oos-proj/trade-desk")).toBe("trade-desk");
    expect(folderName("/Users/minimax/oos-proj/trade-desk/")).toBe("trade-desk");
    expect(folderName(String.raw`C:\Users\mini\proj\trade-desk`)).toBe(
      "trade-desk",
    );
  });
});
