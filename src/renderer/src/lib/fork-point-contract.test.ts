import { describe, expect, it } from "vitest";

import type { AcpForkPoint } from "@openma/common/acp-runtime";
import { SessionStore } from "./session-store";
import { forkPointsByTurn, topLevelAssistantMessages } from "./fork-point";
import type { Turn } from "./session-types";

function turn(partial: Partial<Turn> & Pick<Turn, "id">): Turn {
  return {
    sessionId: "sess",
    promptText: "prompt",
    events: [],
    assistantText: "",
    thoughtText: "",
    status: "complete",
    startedAt: 1,
    ...partial,
  };
}

function chunk(
  messageId: string,
  text: string,
  extra: Record<string, unknown> = {},
): Turn["events"][number] {
  return {
    payload: {
      sessionUpdate: "agent_message_chunk",
      messageId,
      content: { type: "text", text },
      ...extra,
    },
    receivedAt: 1,
  };
}

const sessionFork = {
  level: "session" as const,
  reason: "message-fork-not-advertised" as const,
  message: "This agent can fork the whole session but not from a specific message.",
};

const messageFork = {
  level: "message" as const,
  reason: "message-fork-advertised" as const,
  message: "This agent can fork from a specific message.",
  messageFork: {
    version: 1 as const,
    inclusive: true as const,
    source: "capability" as const,
  },
};

describe("fork points", () => {
  it("merges segment ids, skips thoughts and nested text, and numbers repeated text", () => {
    const turns = [
      turn({
        id: "turn-1",
        startedAt: 1,
        assistantText: "Hello world",
        events: [
          chunk("msg-a:segment:0", "Hello "),
          chunk("msg-a:segment:1", "world"),
          {
            payload: {
              sessionUpdate: "agent_thought_chunk",
              messageId: "thought-1",
              content: { type: "text", text: "thinking" },
            },
            receivedAt: 2,
          },
          chunk("child-1", "nested", {
            _meta: { claudeCode: { parentToolUseId: "toolu-parent" } },
          }),
          {
            payload: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-1",
              rawOutput: "tool output is not assistant text",
            },
            receivedAt: 3,
          },
        ],
      }),
      turn({
        id: "turn-2",
        startedAt: 2,
        assistantText: "Hello world",
        events: [chunk("msg-b", "Hello world")],
      }),
      turn({
        id: "turn-running",
        startedAt: 3,
        status: "running",
        assistantText: "not yet",
        events: [chunk("msg-c", "not yet")],
      }),
    ];

    expect(topLevelAssistantMessages(turns)).toEqual([
      { messageId: "msg-a", text: "Hello world" },
      { messageId: "msg-b", text: "Hello world" },
    ]);
    const points = forkPointsByTurn(turns);
    expect(points.get("turn-1")).toEqual({
      messageId: "msg-a",
      messageText: "Hello world",
      messageOccurrence: 1,
    } satisfies AcpForkPoint);
    expect(points.get("turn-2")?.messageOccurrence).toBe(2);
    expect(points.has("turn-running")).toBe(false);
  });
});

describe("fork draft gate", () => {
  function ready(store: SessionStore, forkSupport: typeof sessionFork | typeof messageFork) {
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-acp",
      agent_id: "pi-acp",
      cwd: "/repo",
      supports_session_fork: true,
      fork_support: forkSupport,
    });
  }

  it("refuses a message point unless forkSupport.level is message", () => {
    const store = new SessionStore();
    ready(store, sessionFork);
    const point: AcpForkPoint = {
      messageId: "msg-a",
      messageText: "Hello world",
      messageOccurrence: 1,
    };

    expect(store.newMainForkDraft("parent-session")).toEqual(expect.stringMatching(/^fork-/));
    expect(store.newMainForkDraft("parent-session", point)).toBeNull();
  });

  it("stores the point on the draft and does not fork when level is none", () => {
    const store = new SessionStore();
    ready(store, messageFork);
    const point: AcpForkPoint = {
      messageId: "msg-a",
      messageText: "Hello world",
      messageOccurrence: 1,
    };
    const forkId = store.newMainForkDraft("parent-session", point);

    expect(store.get(forkId!)?.forkParent).toEqual({
      parentSessionId: "parent-session",
      parentAcpSessionId: "parent-acp",
      inheritance: "fork",
      point,
    });

    store.apply({
      type: "session.ready",
      session_id: "blocked",
      acp_session_id: "blocked-acp",
      agent_id: "codex-acp",
      cwd: "/repo",
      supports_session_fork: true,
      fork_support: {
        level: "none",
        reason: "session-fork-not-advertised",
        message: "This agent does not support forking a session.",
      },
    });
    expect(store.newMainForkDraft("blocked", point)).toBeNull();
    expect(store.newMainForkDraft("blocked")).toBeNull();
  });
});
