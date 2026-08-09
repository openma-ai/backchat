import { describe, expect, test } from "vitest";

import { goalProgressPresentation } from "./goal-progress";

const labels = {
  active: "Pursuing goal",
  paused: "Goal paused",
  stalled: "Goal stalled",
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

describe("a stalled goal", () => {
  test("can be picked back up and says so", () => {
    // The reference client shows "Goal stalled" with a resume control; without
    // this the row had a label it never used and no way forward.
    const presentation = goalProgressPresentation(
      { objective: "使世界和平", status: "stalled" },
      labels,
    );

    expect(presentation.label).toBe("Goal stalled");
    expect(presentation.actions?.resume).toBe(true);
    expect(presentation.actions?.pause).toBe(false);
  });

  test("counts from when the goal was set when no worked time is charged", () => {
    const presentation = goalProgressPresentation(
      {
        objective: "使世界和平",
        status: "active",
        timeUsedSeconds: 0,
        createdAt: Date.now() - 60_000,
      },
      labels,
    );

    expect(presentation.elapsedSince).toBeDefined();
    expect(presentation.elapsedSeconds).toBeGreaterThan(50);
  });
});
