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

  test("uses Codex collaboration metadata instead of the display title", () => {
    expect(
      detectNativeAgentToolEvent({
        toolCallId: "call-meta-spawn",
        title: "Collaborate with agent",
        status: "completed",
        rawInput: {
          prompt: "Inspect lifecycle handling",
          senderThreadId: "parent-thread",
          receiverThreadIds: ["child-thread"],
          agentsStates: {
            "child-thread": { status: "pendingInit", message: null },
          },
        },
        meta: {
          codex: {
            collaboration: {
              tool: "spawn_agent",
              senderThreadId: "parent-thread",
              receiverThreadIds: ["child-thread"],
            },
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        operation: "codex_spawn",
        childId: "child-thread",
        task: "Inspect lifecycle handling",
        status: "running",
      }),
    ]);
  });

  test("normalizes Codex subagent lifecycle metadata from ACP tool calls", () => {
    expect(
      detectNativeAgentToolEvent({
        toolCallId: "call-start-project-map",
        title: "Start subagent project_map",
        kind: "other",
        status: "completed",
        rawInput: {
          agentThreadId: "019f79b8-cdaa-7e82-809a-c0cf65740cd9",
          agentPath: "/root/project_map",
          activityKind: "started",
        },
        meta: {
          codex: {
            subagent: {
              threadId: "019f79b8-cdaa-7e82-809a-c0cf65740cd9",
              path: "/root/project_map",
              activity: "started",
            },
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        operation: "codex_spawn",
        toolCallId: "call-start-project-map",
        childId: "019f79b8-cdaa-7e82-809a-c0cf65740cd9",
        task: "/root/project_map",
        nickname: "project_map",
        status: "running",
      }),
    ]);
  });

  test("maps a completed Codex subagent interrupt activity to cancelled", () => {
    expect(
      detectNativeAgentToolEvent({
        toolCallId: "call-interrupt-project-map",
        title: "Interrupt subagent project_map",
        kind: "other",
        status: "completed",
        rawInput: {
          agentThreadId: "child-thread",
          agentPath: "/root/project_map",
          activityKind: "interrupted",
        },
        meta: {
          codex: {
            subagent: {
              threadId: "child-thread",
              path: "/root/project_map",
              activity: "interrupted",
            },
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "codex",
        childId: "child-thread",
        status: "cancelled",
      }),
    ]);
  });

  test("does not cancel a Codex child until the interrupt activity itself completes", () => {
    const interrupted = {
      toolCallId: "call-interrupt-project-map",
      title: "Interrupt subagent project_map",
      kind: "other" as const,
      rawInput: {
        agentThreadId: "child-thread",
        agentPath: "/root/project_map",
        activityKind: "interrupted",
      },
      meta: {
        codex: {
          subagent: {
            threadId: "child-thread",
            path: "/root/project_map",
            activity: "interrupted",
          },
        },
      },
    };

    expect(detectNativeAgentToolEvent({
      ...interrupted,
      status: "in_progress",
    })).toEqual([
      expect.objectContaining({
        provider: "codex",
        childId: "child-thread",
        status: "running",
      }),
    ]);
    expect(detectNativeAgentToolEvent({
      ...interrupted,
      status: "completed",
    })).toEqual([
      expect.objectContaining({
        provider: "codex",
        childId: "child-thread",
        status: "cancelled",
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

  test("maps Claude AgentOutput completion, result, and per-agent token usage from toolResponse", () => {
    expect(
      detectNativeAgentToolEvent({
        toolCallId: "toolu-agent",
        toolName: "Agent",
        status: "completed",
        meta: {
          claudeCode: {
            toolName: "Agent",
            toolResponse: {
              status: "completed",
              agentId: "agent-usage-1",
              agentType: "Explore",
              content: [{ type: "text", text: "Found the lifecycle gap." }],
              totalToolUseCount: 3,
              totalDurationMs: 1_250,
              totalTokens: 110,
              usage: {
                input_tokens: 50,
                output_tokens: 20,
                cache_creation_input_tokens: 10,
                cache_read_input_tokens: 30,
              },
              prompt: "Inspect lifecycle handling",
            },
          },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "claude",
        operation: "claude_agent",
        toolCallId: "toolu-agent",
        childId: "agent-usage-1",
        agentType: "Explore",
        status: "complete",
        result: "Found the lifecycle gap.",
      }),
      expect.objectContaining({
        provider: "claude",
        toolCallId: "toolu-agent",
        childId: "agent-usage-1",
        usage: {
          inputTokens: 50,
          outputTokens: 20,
          cachedReadTokens: 30,
          cachedWriteTokens: 10,
          totalTokens: 110,
        },
      }),
    ]);
  });

  test("maps Claude subagentRetry tool progress without inventing a lifecycle transition", () => {
    expect(
      detectNativeAgentToolEvent(
        {
          toolCallId: "toolu-agent",
          toolName: "Agent",
          status: "in_progress",
          meta: {
            claudeCode: {
              toolName: "Agent",
              toolResponse: {
                elapsedTimeSeconds: 12,
                subagentType: "Explore",
                subagentRetry: {
                  attempt: 2,
                  max_retries: 5,
                  retry_delay_ms: 1_000,
                },
              },
            },
          },
        },
        {
          provider: "claude",
          operation: "claude_agent",
          toolCallId: "toolu-agent",
          childId: "agent-retry-1",
        },
      ),
    ).toEqual([
      expect.objectContaining({
        provider: "claude",
        toolCallId: "toolu-agent",
        childId: "agent-retry-1",
        progress: {
          kind: "subagent_retry",
          elapsedTimeSeconds: 12,
          subagentType: "Explore",
          retry: {
            attempt: 2,
            max_retries: 5,
            retry_delay_ms: 1_000,
          },
        },
      }),
    ]);
  });

  test("maps Claude non-executed Agent calls to cancelled with the structured reason", () => {
    expect(
      detectNativeAgentToolEvent(
        {
          toolCallId: "toolu-agent-denied",
          toolName: "Agent",
          status: "failed",
          meta: {
            claudeCode: {
              toolName: "Agent",
              nonExecutionKind: "user-rejected",
              userFeedback: "Do not delegate this task",
            },
          },
        },
        {
          provider: "claude",
          operation: "claude_agent",
          toolCallId: "toolu-agent-denied",
          childId: "claude:toolu-agent-denied",
        },
      ),
    ).toEqual([
      expect.objectContaining({
        provider: "claude",
        childId: "claude:toolu-agent-denied",
        status: "cancelled",
        reason: "user-rejected",
        errorMessage: "Do not delegate this task",
      }),
    ]);
  });
});
