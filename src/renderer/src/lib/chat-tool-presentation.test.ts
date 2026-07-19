import { describe, expect, it } from "vitest";

import {
  capitalizeToolLabel,
  detectSkillName,
  pickToolActivityTarget,
  pickToolActivityVerb,
  pickToolTarget,
  pickToolVerb,
  shortToolPath,
} from "./chat-tool-presentation";

describe("chat tool presentation", () => {
  it("uses progress-aware verbs for known and unknown tool kinds", () => {
    expect(pickToolVerb("read", "in_progress")).toBe("读取中");
    expect(pickToolVerb("read", "completed")).toBe("已读取");
    expect(pickToolVerb("terminal", "in_progress")).toBe("运行中");
    expect(pickToolVerb("custom", "completed")).toBe("已调用");
  });

  it("selects the most informative target in title, location, then content order", () => {
    expect(pickToolTarget({
      title: "Inspect repository",
      locations: [{ path: "/Users/mini/project/src/index.ts" }],
    })).toBe("Inspect repository");
    expect(pickToolTarget({
      locations: [{ path: "/Users/mini/project/src/index.ts" }],
    })).toBe("…/src/index.ts");
    expect(pickToolTarget({
      content: [{
        type: "content",
        content: { type: "text", text: "  first line\nsecond line" },
      }],
    })).toBe("first line");
  });

  it("detects skill documents in locations and command arguments", () => {
    expect(detectSkillName({
      locations: [{
        path: "/Users/mini/.codex/skills/.system/imagegen/SKILL.md",
      }],
    })).toBe("imagegen");
    expect(detectSkillName({
      rawInput: {
        command: [
          "sed",
          "-n",
          "1,200p",
          "/Users/mini/.codex/skills/web_research/SKILL.md",
        ],
      },
    })).toBe("web_research");
    expect(detectSkillName({
      locations: [{ path: "/Users/mini/project/skills.md" }],
    })).toBeNull();
  });

  it("presents skill reads consistently in rows and grouped activity", () => {
    const skillRead = {
      kind: "execute",
      status: "in_progress",
      title: "Read the required skill",
      locations: [{
        path: "/Users/mini/.codex/skills/.system/imagegen/SKILL.md",
      }],
    };

    expect(pickToolActivityVerb(skillRead)).toBe("读取中");
    expect(pickToolActivityTarget(skillRead)).toBe("Imagegen 技能");
    expect(
      pickToolActivityVerb({ ...skillRead, status: "completed" }),
    ).toBe("已读取");
  });

  it("keeps tool labels and short paths compact", () => {
    expect(capitalizeToolLabel("web_research")).toBe("Web_research");
    expect(capitalizeToolLabel("")).toBe("");
    expect(shortToolPath("/Users/mini/project/src/index.ts")).toBe(
      "…/src/index.ts",
    );
    expect(shortToolPath("src/index.ts")).toBe("src/index.ts");
  });
});
