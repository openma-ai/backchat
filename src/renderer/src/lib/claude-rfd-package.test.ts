import { expect, test } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SessionStore } from "./session-store";

test("consumes actual Claude ACP 0.95 RFD producer output, not legacy meta fixtures", async () => {
  const entry = pathToFileURL(resolve("node_modules/@agentclientprotocol/claude-agent-acp/dist/native-subagents.js")).href;
  const { NativeSubagentRuntime } = await import(/* @vite-ignore */ entry);
  const store = new SessionStore();
  store.apply({ type: "session.ready", session_id: "host", acp_session_id: "root", agent_id: "claude-acp", cwd: "/repo" });
  store.registerTurn("turn", "host", "delegate");
  const notifications: Array<{ sessionId: string; update: Record<string, unknown> }> = [];
  const publish = async (notification: { sessionId: string; update: Record<string, unknown> }) => {
    notifications.push(notification);
    store.apply({ type: "session.event", session_id: "host", turn_id: "turn", event: {
      ...notification.update, "_openma.acp.notification": { session_id: notification.sessionId },
    } });
  };
  const runtime = new NativeSubagentRuntime("rfd", "root", {}, publish, { log() {} });
  await runtime.route({ sessionId: "root", update: {
    sessionUpdate: "tool_call", toolCallId: "launch", title: "Agent", status: "in_progress",
    rawInput: { subagent_type: "Explore", description: "Audit", prompt: "Inspect" },
    _meta: { claudeCode: { toolName: "Agent", subagent: true } },
  } }, publish);
  await runtime.taskStarted({ taskId: "task-child", toolUseId: "launch", subagentType: "Explore", description: "Audit", prompt: "Inspect" }, publish);
  expect(notifications.some((entry) => entry.update.sessionUpdate === "subagent_update")).toBe(true);
  const routed = await runtime.route({ sessionId: "root", update: {
    sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Actual child output" },
    _meta: { claudeCode: { parentToolUseId: "launch" } },
  } }, publish);
  if (routed) await publish(routed);
  await runtime.finishTask("task-child", "completed", publish, "launch");
  const activity = store.subagentsFor("host")[0]!;
  expect(store.turnsFor(activity.viewSessionId)[0]?.assistantText).toBe("Actual child output");
  expect(activity.status).toBe("complete");
  expect(store.turnsFor("host")[0]?.assistantText).toBe("");
});
