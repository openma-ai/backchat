import { describe, expect, test } from "vitest";
import {
  detectNativeAgentRawEvent,
  detectNativeAgentToolEvent,
} from "./native-agent-events";

describe("native agent event detection", () => {
  test("normalizes Codex CLI collab_tool_call spawn events", () => {
    expect(
      detectNativeAgentRawEvent({
        type: "collab_tool_call",
        tool: "spawn_agent",
        sender_thread_id: "parent-thread",
        receiver_thread_ids: ["child-thread"],
        prompt: "Reply exactly CHILD_OK",
        agents_states: { child: { status: "pending_init" } },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        operation: "codex_spawn",
        childId: "child-thread",
        task: "Reply exactly CHILD_OK",
        status: "running",
      }),
    ]);
  });

  test("unwraps Codex exec JSONL item wrappers", () => {
    expect(
      detectNativeAgentRawEvent({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "collab_tool_call",
          tool: "spawn_agent",
          sender_thread_id: "parent-thread",
          receiver_thread_ids: ["child-thread"],
          prompt: "Reply exactly: CHILD_OK",
          agents_states: {
            "child-thread": { status: "pending_init", message: null },
          },
          status: "completed",
        },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        operation: "codex_spawn",
        childId: "child-thread",
        task: "Reply exactly: CHILD_OK",
        status: "running",
      }),
    ]);
  });

  test("normalizes codex-acp camelCase spawn/wait/close tool calls", () => {
    expect(
      detectNativeAgentToolEvent({
        toolCallId: "call-spawn",
        title: "spawnAgent",
        status: "completed",
        rawInput: {
          prompt: "Reply exactly CHILD_OK.",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          agentsStates: {
            "child-thread": { status: "pendingInit", message: null },
          },
          status: "completed",
        },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        operation: "codex_spawn",
        childId: "child-thread",
        task: "Reply exactly CHILD_OK.",
        status: "running",
      }),
    ]);

    expect(
      detectNativeAgentToolEvent({
        toolCallId: "call-wait",
        title: "wait",
        status: "completed",
        rawInput: {
          receiverThreadIds: ["child-thread"],
          agentsStates: {
            "child-thread": { status: "completed", message: "CHILD_OK" },
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        operation: "codex_wait",
        toolCallId: "call-wait",
        childId: "child-thread",
        status: "complete",
        result: "CHILD_OK",
      }),
    ]);

    expect(
      detectNativeAgentToolEvent({
        toolCallId: "call-close",
        title: "closeAgent",
        status: "completed",
        rawInput: {
          receiverThreadIds: ["child-thread"],
          agentsStates: {
            "child-thread": { status: "completed", message: "CHILD_OK" },
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        operation: "codex_close",
        toolCallId: "call-close",
        childId: "child-thread",
        status: "complete",
        result: "CHILD_OK",
        closed: true,
      }),
    ]);
  });

  test("normalizes Codex CLI collab_tool_call wait states keyed by child nickname", () => {
    expect(
      detectNativeAgentRawEvent({
        type: "collab_tool_call",
        tool: "wait",
        receiver_thread_ids: ["child-thread"],
        agents_states: {
          child: { status: "completed", message: "CHILD_OK" },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        operation: "codex_wait",
        childId: "child-thread",
        status: "complete",
        result: "CHILD_OK",
      }),
    ]);
  });

  test("keeps Codex split spawn output running when only the output update has a child id", () => {
    const [spawn] = detectNativeAgentToolEvent({
      toolCallId: "call-spawn",
      toolName: "spawn_agent",
      status: "pending",
      rawInput: {
        fork_context: false,
        message: "Inspect native sessions",
      },
    });

    expect(
      detectNativeAgentToolEvent(
        {
          toolCallId: "call-spawn",
          status: "completed",
          rawOutput: { agent_id: "child-thread", nickname: "Cicero" },
        },
        {
          provider: "codex",
          operation: spawn?.operation,
          toolCallId: "call-spawn",
          childId: spawn?.childId ?? "codex:call-spawn",
        },
      ),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        operation: "codex_spawn",
        childId: "child-thread",
        nickname: "Cicero",
        status: "running",
      }),
    ]);
  });

  test("does not infer Claude child ids from plain result text", () => {
    expect(
      detectNativeAgentToolEvent(
        {
          toolCallId: "toolu-task",
          status: "completed",
          rawOutput:
            "Findings ready.\nagentId: claude-child-agent (use SendMessage with to: 'claude-child-agent')",
        },
        {
          provider: "claude",
          operation: "claude_agent",
          toolCallId: "toolu-task",
          childId: "claude:toolu-task",
        },
      ),
    ).toEqual([
      expect.objectContaining({
        provider: "claude",
        childId: "claude:toolu-task",
        status: "complete",
        result: expect.stringContaining("Findings ready."),
      }),
    ]);
  });

  test("uses Claude ACP structured toolResponse agent id from _meta", () => {
    expect(
      detectNativeAgentToolEvent(
        {
          toolCallId: "toolu-task",
          status: "completed",
          rawOutput: [
            {
              type: "text",
              text: "Async agent launched successfully.\nagentId: text-only",
            },
          ],
          meta: {
            claudeCode: {
              toolName: "Agent",
              toolResponse: {
                isAsync: true,
                status: "async_launched",
                agentId: "ae5e31bb86074b018",
                description: "Reply CHILD_OK test",
                prompt: "Reply exactly: CHILD_OK",
              },
            },
          },
        },
        {
          provider: "claude",
          operation: "claude_agent",
          toolCallId: "toolu-task",
          childId: "claude:toolu-task",
        },
      ),
    ).toEqual([
      expect.objectContaining({
        provider: "claude",
        childId: "ae5e31bb86074b018",
        status: "running",
      }),
    ]);
  });
});
