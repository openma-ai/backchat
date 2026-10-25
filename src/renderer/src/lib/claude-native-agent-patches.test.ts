import { describe, expect, test } from "vitest";
import { claudeCodeRuntimeAdapter, type RuntimeToolEvent } from "./agent-runtime-adapters";
import {
  detectClaudeCodeNativeAgentToolEvent,
  type NativeAgentContext,
} from "./native-agent-events";

const context: NativeAgentContext = {
  provider: "claude",
  operation: "claude_agent",
  toolCallId: "launch-1",
  childId: "child-1",
  task: "Audit lifecycle",
  agentType: "Explore",
};
const asyncContext = { ...context, asyncLaunched: true };
const launch: RuntimeToolEvent = {
  toolCallId: "launch-1",
  meta: { claudeCode: { toolResponse: {
    status: "async_launched", isAsync: true, agentId: "child-1",
  } } },
};

describe("Claude native agent split patches", () => {
  // Dropping launch evidence from normalized updates loses it at the store boundary.
  test("exports the observed async launch fact for the session-owned context", () => {
    expect(detectClaudeCodeNativeAgentToolEvent(launch, context)).toEqual([
      expect.objectContaining({ childId: "child-1", status: "running", asyncLaunched: true }),
    ]);
  });

  // Regresses if ACP tool completion is treated as background child completion.
  test.each([undefined, "Agent", "Task"])(
    "keeps a launched child running on metadata-free completion (%s)",
    (toolName) => {
      expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
        toolCallId: "launch-1", toolName, status: "completed", rawOutput: "Launch acknowledged",
      }, asyncContext)).toEqual([
        expect.objectContaining({ childId: "child-1", status: "running", asyncLaunched: true,
          result: undefined }),
      ]);
    },
  );

  test("uses accumulated launch evidence when the current completion omits metadata", () => {
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "launch-1", status: "completed",
    }, context, { ...launch, toolName: "Agent", status: "completed" })).toEqual([
      expect.objectContaining({ childId: "child-1", status: "running", asyncLaunched: true }),
    ]);
  });

  test("does not lose current launch metadata to common's shallow logical meta replacement", () => {
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates(launch, context, {
      toolCallId: "launch-1", toolName: "Agent", status: "completed",
      rawInput: { description: "Inspect split patches", subagent_type: "Explore" },
      meta: { claudeCode: { toolName: "Agent" } },
    })).toEqual([
      expect.objectContaining({ childId: "child-1", task: "Inspect split patches",
        agentType: "Explore", status: "running", asyncLaunched: true }),
    ]);
  });

  test.each([undefined, "Agent", "Task"])(
    "accepts a later explicit child completion despite remembered launch and stale logical metadata (%s)",
    (toolName) => {
      expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
        toolCallId: "launch-1", toolName, status: "completed",
        meta: { claudeCode: { toolResponse: {
          status: "completed", content: [{ type: "text", text: "Audit finished" }],
          usage: { input_tokens: 5, output_tokens: 3 },
        } } },
      }, asyncContext, { ...launch, toolName })).toEqual([
        expect.objectContaining({ childId: "child-1", status: "complete", result: "Audit finished" }),
        expect.objectContaining({ childId: "child-1", usage: {
          inputTokens: 5, outputTokens: 3, totalTokens: 8,
        } }),
      ]);
    },
  );

  test.each([undefined, "Agent", "Task"])("retains synchronous completion (%s)", (toolName) => {
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "launch-1", toolName, status: "completed", rawOutput: "Synchronous result",
    }, context)).toEqual([
      expect.objectContaining({ status: "complete", result: "Synchronous result" }),
    ]);
  });

  test("session-owned context carries launch evidence across unrelated shallow metadata patches", () => {
    const [started] = claudeCodeRuntimeAdapter.nativeAgentToolUpdates(launch, context);
    const savedContext: NativeAgentContext = {
      ...context, asyncLaunched: started?.asyncLaunched,
    };
    const [progress] = claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "launch-1", meta: { claudeCode: { toolResponse: { elapsedTimeSeconds: 4 } } },
    }, savedContext, { toolCallId: "launch-1", toolName: "Agent" });
    expect(progress?.progress).toMatchObject({ elapsedTimeSeconds: 4 });
    const nextContext = {
      ...savedContext, asyncLaunched: progress?.asyncLaunched ?? savedContext.asyncLaunched,
    };
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "launch-1", status: "completed",
    }, nextContext, {
      toolCallId: "launch-1", toolName: "Agent", meta: { unrelated: true },
    })).toEqual([expect.objectContaining({ status: "running", asyncLaunched: true })]);
  });

  test("a final child result is not swallowed by progress fields in the same response", () => {
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "launch-1", toolName: "Agent", status: "completed",
      meta: { claudeCode: { toolResponse: {
        status: "completed", elapsedTimeSeconds: 8, subagentType: "Explore", content: "Done",
      } } },
    }, asyncContext)).toEqual([expect.objectContaining({ status: "complete", result: "Done" })]);
  });

  test("does not leak async launch state to another session reusing the tool id", () => {
    claudeCodeRuntimeAdapter.nativeAgentToolUpdates(launch, context);
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "launch-1", toolName: "Agent", status: "completed",
    })).toEqual([expect.objectContaining({ status: "complete" })]);
    expect(context).not.toHaveProperty("asyncLaunched");
  });

  test.each([undefined, "Agent"])("a failed launcher patch is not a child failure after async launch (%s)", (toolName) => {
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "launch-1", toolName, status: "failed", rawOutput: "Launcher disconnected",
    }, asyncContext)).toEqual([expect.objectContaining({ status: "running" })]);
  });

  test.each([undefined, "Agent"])("preserves synchronous rejection and structured reason (%s)", (toolName) => {
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "launch-1", toolName, status: "failed",
      meta: { claudeCode: { nonExecutionKind: "user-rejected", userFeedback: "Do not delegate" } },
    }, context)).toEqual([expect.objectContaining({
      status: "cancelled", reason: "user-rejected", errorMessage: "Do not delegate",
    })]);
  });

  test("nested tool completion reports activity rather than terminating the async child", () => {
    const updates = claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "read-1", parentToolUseId: "launch-1", toolName: "Read", status: "completed",
    }, asyncContext);
    expect(updates).toEqual([expect.objectContaining({
      childId: "child-1", toolCallId: "launch-1", childToolCallId: "read-1",
    })]);
    expect(updates[0]?.status).toBeUndefined();
  });
});
