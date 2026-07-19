import { describe, expect, it } from "vitest";

import {
  moveComposerSlashPickerIndex,
  reconcileComposerSkillCommand,
  resolveComposerSlashQuery,
} from "./composer-slash-state";

describe("composer slash state", () => {
  it("keeps a dismissed picker closed only for the exact unchanged text", () => {
    expect(resolveComposerSlashQuery("/comp", "/comp")).toBeNull();
    expect(resolveComposerSlashQuery("/compact", "/comp")).toBe("compact");
    expect(resolveComposerSlashQuery("hello", null)).toBeNull();
  });

  it("wraps slash selection in both directions without producing an invalid empty index", () => {
    expect(moveComposerSlashPickerIndex(2, 3, "next")).toBe(0);
    expect(moveComposerSlashPickerIndex(0, 3, "previous")).toBe(2);
    expect(moveComposerSlashPickerIndex(4, 0, "next")).toBe(0);
  });

  it("clears a selected skill when the agent no longer advertises it", () => {
    const skill = { name: "skill:review", kind: "skill" };

    expect(reconcileComposerSkillCommand(skill, [
      { name: "compact" },
      skill,
    ])).toBe(skill);
    expect(reconcileComposerSkillCommand(skill, [
      { name: "compact" },
    ])).toBeNull();
    expect(reconcileComposerSkillCommand(null, [])).toBeNull();
  });
});
