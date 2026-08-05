import { describe, expect, test } from "vitest";

import { composerProgressSummary } from "./composer-progress";

describe("composerProgressSummary", () => {
  test("reports the active item and completed count", () => {
    expect(
      composerProgressSummary([
        { content: "Inspect files", status: "completed" },
        { content: "Patch reducer", status: "in_progress" },
        { content: "Run tests", status: "pending" },
        { content: "Document behavior", status: "pending" },
      ]),
    ).toEqual({ currentItem: 2, total: 4, completed: 1 });
  });

  test("uses the first pending item when none is currently running", () => {
    expect(
      composerProgressSummary([
        { content: "Inspect files", status: "completed" },
        { content: "Patch reducer", status: "pending" },
      ]),
    ).toEqual({ currentItem: 2, total: 2, completed: 1 });
  });

  test("keeps the final item selected after every item completes", () => {
    expect(
      composerProgressSummary([
        { content: "Inspect files", status: "completed" },
        { content: "Patch reducer", status: "completed" },
      ]),
    ).toEqual({ currentItem: 2, total: 2, completed: 2 });
  });
});
