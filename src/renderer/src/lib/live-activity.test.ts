import { describe, expect, it } from "vitest";

import { liveActivityState } from "./live-activity";
import type { TurnRender } from "@/lib/reduce-turn";
import type { ActivityTool } from "@/lib/activity-tool-groups";

type TimelineItem = TurnRender["timeline"][number];

const text = (): TimelineItem => ({
  kind: "assistant_text",
  text: "words",
  phase: "commentary",
});
const thought = (): TimelineItem => ({ kind: "thought", text: "reasoning" });
const toolItem = (id: string): TimelineItem => ({ kind: "tool", toolCallId: id });

const tool = (id: string, status: string): ActivityTool =>
  ({ toolCallId: id, status, kind: "execute", title: "bash" }) as ActivityTool;

function render(timeline: TimelineItem[]): TurnRender {
  return {
    thoughtText: "",
    currentThoughtText: "",
    assistantText: "",
    tools: [],
    plan: [],
    notes: [],
    timeline,
  } as unknown as TurnRender;
}

const describeCommand = () => "cargo test";

/** Every state the last row can be in, and the one input that decides it. The
 *  combinations these cover are the ones that used to be decided by separate
 *  booleans at the call site, which is how the same sentence came to be printed
 *  twice and how the fallback ended up under streaming text. */
describe("liveActivityState", () => {
  it("reports nothing once the turn has ended", () => {
    expect(
      liveActivityState({
        rendered: render([text()]),
        isStreaming: false,
        liveTools: [tool("t1", "in_progress")],
        describeCommand,
      }),
    ).toEqual({ kind: "settled" });
  });

  it("lets an arriving answer speak for itself", () => {
    expect(
      liveActivityState({
        rendered: render([toolItem("t1"), text()]),
        isStreaming: true,
        liveTools: [tool("t1", "completed")],
        describeCommand,
      }),
    ).toEqual({ kind: "answering" });
  });

  it("lets a streaming thinking block speak for itself", () => {
    expect(
      liveActivityState({
        rendered: render([text(), thought()]),
        isStreaming: true,
        liveTools: [tool("t1", "completed")],
        describeCommand,
      }),
    ).toEqual({ kind: "reasoning" });
  });

  it("lets the block speak even while a tool runs beneath it", () => {
    // Codex thinks while its tools run, and the reasoning is the better report.
    // The running tool is not lost: it keeps its own row and spinner in the
    // block above, so this row does not have to repeat it.
    expect(
      liveActivityState({
        rendered: render([toolItem("t1"), thought()]),
        isStreaming: true,
        liveTools: [tool("t1", "in_progress")],
        describeCommand,
      }),
    ).toEqual({ kind: "reasoning" });
  });

  it("names the running command when nothing else is arriving", () => {
    expect(
      liveActivityState({
        rendered: render([text(), toolItem("t1")]),
        isStreaming: true,
        liveTools: [tool("t0", "completed"), tool("t1", "in_progress")],
        describeCommand,
      }),
    ).toEqual({ kind: "running", command: "cargo test" });
  });

  it("still reports tool work when the running tool has no command to name", () => {
    expect(
      liveActivityState({
        rendered: render([toolItem("t1")]),
        isStreaming: true,
        liveTools: [tool("t1", "in_progress")],
        describeCommand: () => "   ",
      }),
    ).toEqual({ kind: "tools" });
  });

  it("keeps reporting tool work in the gap after the last tool closes", () => {
    // A closed tool is not the end of the tool work: the next call is usually
    // already on its way, and reading "thinking" in that gap said the turn had
    // moved on when it had not.
    expect(
      liveActivityState({
        rendered: render([toolItem("t1")]),
        isStreaming: true,
        liveTools: [tool("t1", "completed")],
        describeCommand,
      }),
    ).toEqual({ kind: "tools" });
  });

  it("waits only when the turn has done nothing at all yet", () => {
    expect(
      liveActivityState({
        rendered: render([]),
        isStreaming: true,
        liveTools: [],
        describeCommand,
      }),
    ).toEqual({ kind: "waiting" });
  });
});
