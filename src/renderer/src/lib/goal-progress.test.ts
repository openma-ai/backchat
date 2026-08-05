import { describe, expect, test } from "vitest";

import { goalProgressPresentation } from "./goal-progress";

const labels = {
  active: "Pursuing goal",
  paused: "Goal paused",
  complete: "Goal complete",
  blocked: "Goal blocked",
  fallback: "Goal",
};

describe("goalProgressPresentation", () => {
  test("does not bind protocol plan items to a Goal by default", () => {
    expect(
      goalProgressPresentation(
        {
          objective: "Ship progress surfaces",
          status: "active",
          timeUsedSeconds: 12,
        },
        labels,
      ),
    ).toMatchObject({
      kind: "goal",
      label: "Pursuing goal",
      title: "Ship progress surfaces",
      elapsedSeconds: 12,
      items: [],
    });
  });

  test("maps terminal Goal status to presentation tone", () => {
    expect(
      goalProgressPresentation(
        { objective: "Ship progress surfaces", status: "completed" },
        labels,
      ),
    ).toMatchObject({
      label: "Goal complete",
      tone: "success",
    });
  });

  test("maps active and paused Goal states to distinct GUI actions", () => {
    expect(
      goalProgressPresentation(
        { objective: "Ship progress surfaces", status: "active" },
        labels,
      ).actions,
    ).toMatchObject({ pause: true, resume: false });
    expect(
      goalProgressPresentation(
        { objective: "Ship progress surfaces", status: "paused" },
        labels,
      ).actions,
    ).toMatchObject({ pause: false, resume: true });
  });
});
