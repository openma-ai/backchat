import { describe, expect, it } from "vitest";

import { promptCommandAnnotation } from "./prompt-command-annotation";

describe("a prompt the composer sent as a command invocation", () => {
  const commands = [
    { name: "goal", input: { hint: "[<objective>|clear|pause|resume]" } },
    { name: "review", input: { hint: "optional review instructions" } },
    { name: "plan", input: null },
  ];

  it("splits the argument from the prefix the composer added", () => {
    expect(promptCommandAnnotation("/goal 保护世界和平", commands)).toEqual({
      command: "goal",
      body: "保护世界和平",
    });
  });

  it("leaves a bare command alone", () => {
    // No argument means no message body to relabel.
    expect(promptCommandAnnotation("/goal", commands)).toBeUndefined();
  });

  it("leaves a command with no label of its own alone", () => {
    // /review is advertised but has no state copy; inventing one would be
    // worse than showing what the user sees in the composer.
    expect(promptCommandAnnotation("/review this diff", commands)).toBeUndefined();
  });

  it("leaves an unadvertised command alone", () => {
    expect(promptCommandAnnotation("/goal do it", [{ name: "review" }])).toBeUndefined();
  });

  it("leaves ordinary text alone, including a path", () => {
    expect(promptCommandAnnotation("goal 保护世界和平", commands)).toBeUndefined();
    expect(promptCommandAnnotation("/usr/local/bin matters", commands)).toBeUndefined();
  });

  it("does not relabel a control word as a goal", () => {
    // The hint declares [<objective>|clear|pause|resume]: only <objective> is
    // content. The composer's own exit fallback sends "/goal clear", so calling
    // that "sent as goal" would invert its meaning.
    for (const verb of ["clear", "pause", "resume"]) {
      expect(promptCommandAnnotation(`/goal ${verb}`, commands)).toBeUndefined();
    }
  });

  it("keeps a multi-line argument whole", () => {
    expect(promptCommandAnnotation("/goal line one\nline two", commands)).toEqual({
      command: "goal",
      body: "line one\nline two",
    });
  });
});
