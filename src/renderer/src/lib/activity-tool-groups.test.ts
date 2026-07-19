import { describe, expect, it } from "vitest";

import type { TurnRender } from "./reduce-turn";
import {
  groupActivityTools,
  isToolRunning,
  projectActivityTools,
  type ActivityTool,
} from "./activity-tool-groups";

function tool(
  toolCallId: string,
  overrides: Partial<ActivityTool> = {},
): ActivityTool {
  return {
    toolCallId,
    kind: "execute",
    status: "completed",
    title: toolCallId,
    ...overrides,
  };
}

function rendered(
  tools: ActivityTool[],
  timeline: TurnRender["timeline"] = tools.map((entry) => ({
    kind: "tool",
    toolCallId: entry.toolCallId,
  })),
): TurnRender {
  return {
    thoughtText: "",
    currentThoughtText: "",
    assistantText: "",
    tools,
    plan: [],
    notes: [],
    timeline,
  };
}

describe("projectActivityTools", () => {
  it("keeps only the latest completed duplicate and latest running tool", () => {
    const state = rendered([
      tool("old", {
        kind: "read",
        title: "Read file '/tmp/a'",
        locations: [{ path: "/tmp/a" }],
      }),
      tool("new", {
        kind: "read",
        title: "Read file '/tmp/a'",
        locations: [{ path: "/tmp/a" }],
      }),
      tool("running-old", { status: "pending" }),
      tool("running-new", { status: "in_progress" }),
    ]);

    const projection = projectActivityTools(state, true);

    expect([...projection.visibleToolIds]).toEqual(["new"]);
    expect(projection.activeTool?.toolCallId).toBe("running-new");
  });

  it("does not treat pending tools as active after streaming ends", () => {
    const projection = projectActivityTools(
      rendered([tool("pending", { status: "pending" })]),
      false,
    );

    expect(projection.activeTool).toBeUndefined();
    expect([...projection.visibleToolIds]).toEqual(["pending"]);
  });
});

describe("groupActivityTools", () => {
  it("lets Codex group tools across hidden thought summaries", () => {
    const tools = [tool("one"), tool("two")];
    const state = rendered(tools, [
      { kind: "tool", toolCallId: "one" },
      { kind: "thought", messageId: "thought", text: "Planning" },
      { kind: "tool", toolCallId: "two" },
    ]);

    const groups = groupActivityTools({
      rendered: state,
      visibleToolIds: new Set(["one", "two"]),
      activeTool: undefined,
      groupAcrossThoughts: true,
    });

    expect([...groups.byStartIndex.values()].map((group) => group.length)).toEqual([
      2,
    ]);
  });

  it("uses generic timeline boundaries for other harnesses", () => {
    const tools = [tool("one"), tool("two")];
    const state = rendered(tools, [
      { kind: "tool", toolCallId: "one" },
      { kind: "thought", messageId: "thought", text: "Planning" },
      { kind: "tool", toolCallId: "two" },
    ]);

    const groups = groupActivityTools({
      rendered: state,
      visibleToolIds: new Set(["one", "two"]),
      activeTool: undefined,
      groupAcrossThoughts: false,
    });

    expect([...groups.byStartIndex.values()].map((group) => group.length)).toEqual([
      1,
      1,
    ]);
  });
});

describe("isToolRunning", () => {
  it.each([undefined, "pending", "in_progress"])(
    "treats %s as running",
    (status) => {
      expect(isToolRunning(status)).toBe(true);
    },
  );

  it.each(["completed", "failed"])("treats %s as terminal", (status) => {
    expect(isToolRunning(status)).toBe(false);
  });
});
