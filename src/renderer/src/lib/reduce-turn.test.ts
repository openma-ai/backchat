import { describe, expect, test } from "vitest";
import { reduceTurn } from "./reduce-turn";

function render(...payloads: unknown[]) {
  return reduceTurn(payloads.map((payload) => ({ payload })));
}

describe("reduceTurn ACP event compatibility", () => {
  test("unwraps ACP session notifications and preserves text/tool chronology", () => {
    const out = render(
      {
        sessionId: "acp-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Before " },
        },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read notes.md",
        kind: "read",
        status: "pending",
      },
      {
        sessionId: "acp-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "after." },
        },
      },
    );

    expect(out.assistantText).toBe("Before after.");
    expect(out.timeline).toEqual([
      { kind: "assistant_text", text: "Before " },
      { kind: "tool", toolCallId: "tool-1" },
      { kind: "assistant_text", text: "after." },
    ]);
  });

  test("parses snake_case tool call aliases from ACP implementations", () => {
    const out = render({
      type: "tool_call_update",
      tool_call_id: "tool-2",
      tool_name: "Bash",
      raw_input: { command: "ls" },
      raw_output: "ok",
      status: "completed",
    });

    expect(out.tools).toEqual([
      {
        toolCallId: "tool-2",
        title: "Bash",
        toolName: "Bash",
        rawInput: { command: "ls" },
        rawOutput: "ok",
        status: "completed",
      },
    ]);
    expect(out.timeline).toEqual([{ kind: "tool", toolCallId: "tool-2" }]);
  });

  test("renders OpenMA thinking and tool use/result events through the existing turn shape", () => {
    const out = render(
      {
        type: "agent.thinking",
        thinking_id: "think-1",
        text: "Checking project files",
      },
      {
        type: "agent.tool_use",
        id: "tool-1",
        name: "pwd",
        input: { cmd: "pwd" },
      },
      {
        type: "agent.tool_result",
        tool_use_id: "tool-1",
        content: "/tmp/project\n",
      },
      {
        type: "agent.message",
        message_id: "msg-1",
        content: [{ type: "text", text: "Done." }],
      },
    );

    expect(out.thoughtText).toBe("Checking project files");
    expect(out.tools).toEqual([
      {
        toolCallId: "tool-1",
        title: "pwd",
        toolName: "pwd",
        rawInput: { cmd: "pwd" },
        rawOutput: "/tmp/project\n",
        status: "completed",
      },
    ]);
    expect(out.assistantText).toBe("Done.");
  });

  test("drops user echoes and transport diagnostics instead of rendering them as assistant prose", () => {
    const out = render(
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "hello" },
      },
      {
        type: "agent_message_chunk",
        content: "Falling back from WebSockets to HTTPS transport. request timed out",
      },
      { type: "session.status_running" },
      { type: "session.status_idle" },
    );

    expect(out.assistantText).toBe("");
    expect(out.timeline).toEqual([]);
    expect(out.tools).toEqual([]);
  });

  test("surfaces permission requests as pending tool calls", () => {
    const out = render({
      type: "requestPermission",
      params: {
        id: "perm-1",
        title: "Run shell command",
        options: [{ optionId: "allow", kind: "allow_once" }],
      },
    });

    expect(out.notes).toEqual([]);
    expect(out.tools).toEqual([
      {
        toolCallId: "permission-perm-1",
        title: "Run shell command",
        kind: "permission",
        status: "pending",
        rawInput: {
          id: "perm-1",
          title: "Run shell command",
          options: [{ optionId: "allow", kind: "allow_once" }],
        },
      },
    ]);
  });

  test("parses ACP 0.25 plan update and removal events into visible turn state", () => {
    const out = render(
      {
        sessionUpdate: "plan_update",
        plan: {
          content: {
            type: "plan",
            entries: [
              { content: "Inspect files", status: "completed", priority: "high" },
              { content: "Patch reducer", status: "in_progress", priority: "medium" },
            ],
          },
        },
      },
      {
        sessionUpdate: "plan_removed",
        id: "plan-1",
      },
    );

    expect(out.plan).toEqual([
      { content: "Inspect files", status: "completed", priority: "high" },
      { content: "Patch reducer", status: "in_progress", priority: "medium" },
    ]);
    expect(out.notes).toEqual(["Plan removed: plan-1"]);
  });
});
