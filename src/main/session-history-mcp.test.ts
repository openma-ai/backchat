import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SessionHistoryMcpBridge,
  type SessionHistoryToolTarget,
} from "./session-history-mcp.js";
import { formatSessionHistory } from "./session-history-tool.js";

const bridges: SessionHistoryMcpBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
});

describe("SessionHistoryMcpBridge", () => {
  it("formats persisted events as a readable, bounded transcript", () => {
    const result = formatSessionHistory(
      {
        id: "session-design",
        title: "Design review",
        agent_id: "codex-acp",
        cwd: "/tmp/design",
      },
      [
        { seq: 1, session_id: "session-design", type: "user_prompt", data: JSON.stringify({ text: "Please review" }), ts: 1 },
        { seq: 2, session_id: "session-design", type: "agent_message_chunk", data: JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Looks " } }), ts: 2 },
        { seq: 3, session_id: "session-design", type: "agent_message_chunk", data: JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "good." } }), ts: 3 },
        { seq: 4, session_id: "session-design", type: "agent_thought_chunk", data: JSON.stringify({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hidden" } }), ts: 4 },
      ],
      { max_chars: 10_000 },
    );

    expect(result.content).toContain("# Design review");
    expect(result.content).toContain("## User\nPlease review");
    expect(result.content).toContain("## Assistant\nLooks good.");
    expect(result.content).not.toContain("hidden");
    expect(result.has_more).toBe(false);
  });

  it("lists and reads another session through task-scoped tools", async () => {
    const tools: SessionHistoryToolTarget = {
      list: vi.fn(async (taskId, input) => ({
        taskId,
        input,
        sessions: [
          {
            id: "session-design",
            title: "Design review",
            agent_id: "codex-acp",
            last_used_at: 123,
          },
        ],
      })),
      read: vi.fn(async (taskId, input) => ({
        taskId,
        input,
        content: "## User\nPlease review the design\n\n## Assistant\nLooks good.",
      })),
    };
    const bridge = new SessionHistoryMcpBridge(tools, { token: "test-token" });
    bridges.push(bridge);
    await bridge.start();

    const descriptor = bridge.descriptor("session-current");
    const client = new Client({ name: "session-history-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: {
        headers: Object.fromEntries(
          descriptor.headers.map(({ name, value }) => [name, value]),
        ),
      },
    });
    await client.connect(transport);

    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "openma_sessions_list",
      "openma_sessions_read",
    ]);
    const listed = await client.callTool({
      name: "openma_sessions_list",
      arguments: { query: "design" },
    });
    expect(tools.list).toHaveBeenCalledWith("session-current", { query: "design" });
    expect(JSON.parse(firstText(listed))).toMatchObject({
      sessions: [{ id: "session-design" }],
    });

    const read = await client.callTool({
      name: "openma_sessions_read",
      arguments: { session_id: "session-design" },
    });
    expect(tools.read).toHaveBeenCalledWith("session-current", {
      session_id: "session-design",
    });
    expect(firstText(read)).toContain(
      "Please review the design",
    );
    await client.close();
  });

  it("rejects attempts to read the current session", async () => {
    const tools: SessionHistoryToolTarget = {
      list: vi.fn(async () => ({ taskId: "", input: {}, sessions: [] })),
      read: vi.fn(async () => ({ taskId: "", input: {}, content: "" })),
    };
    const bridge = new SessionHistoryMcpBridge(tools, { token: "test-token" });
    bridges.push(bridge);
    await bridge.start();
    const descriptor = bridge.descriptor("session-current");
    const client = new Client({ name: "session-history-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: {
        headers: Object.fromEntries(
          descriptor.headers.map(({ name, value }) => [name, value]),
        ),
      },
    });
    await client.connect(transport);

    const result = await client.callTool({
      name: "openma_sessions_read",
      arguments: { session_id: "session-current" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(
      /current session/i,
    );
    expect(tools.read).not.toHaveBeenCalled();
    await client.close();
  });
});

function firstText(result: unknown): string {
  const record = result && typeof result === "object" ? result as { content?: unknown } : {};
  const content = Array.isArray(record.content) ? record.content : [];
  const first = content[0];
  return first && typeof first === "object" && "type" in first && first.type === "text"
    && "text" in first && typeof first.text === "string"
    ? first.text
    : "";
}
