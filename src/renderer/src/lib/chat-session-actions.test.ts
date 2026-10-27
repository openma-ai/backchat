import { describe, expect, it } from "vitest";

import {
  resolveChatAskResponse,
  resolveChatCancelFallbackTurnIds,
  resolveChatCancelTarget,
  resolveChatConfigSessionId,
  resolveResponseSideChatDraft,
} from "./chat-session-actions";

describe("chat session actions", () => {
  it("routes permission and filesystem asks to their matching IPC response", () => {
    expect(resolveChatAskResponse({
      kind: "permission",
      ask: { requestId: "permission-1" },
    }, "allow-once", false)).toEqual({
      kind: "permission",
      requestId: "permission-1",
      optionId: "allow-once",
    });
    expect(resolveChatAskResponse({
      kind: "permission",
      ask: { requestId: "permission-1" },
    }, null, false)).toBeNull();
    expect(resolveChatAskResponse({
      kind: "fsWrite",
      ask: { requestId: "write-1" },
    }, null, true)).toEqual({
      kind: "fsWrite",
      requestId: "write-1",
      approve: true,
    });
  });

  it("only targets live sessions for config changes and owned active turns for cancellation", () => {
    expect(resolveChatConfigSessionId(null)).toBeNull();
    expect(resolveChatConfigSessionId({
      id: "draft-1",
      status: "draft",
    })).toBeNull();
    expect(resolveChatConfigSessionId({
      id: "session-1",
      status: "ready",
    })).toBe("session-1");

    expect(resolveChatCancelTarget({
      id: "session-1",
      activeTurnId: "turn-1",
    }, false)).toEqual({
      session_id: "session-1",
      turn_id: "turn-1",
    });
    expect(resolveChatCancelTarget({
      id: "session-1",
      activeTurnId: "turn-1",
    }, true)).toBeNull();
    expect(resolveChatCancelTarget({
      id: "session-1",
    }, false)).toBeNull();
  });

  it("falls back to a running or pending turn when the active turn id is missing", () => {
    // The stop control is shown for a running turn and for a send that is
    // still pending — both must reach the host even when the session row
    // never carried an activeTurnId.
    expect(resolveChatCancelTarget({
      id: "session-1",
    }, false, ["turn-running"])).toEqual({
      session_id: "session-1",
      turn_id: "turn-running",
    });
    expect(resolveChatCancelTarget({
      id: "session-1",
      activeTurnId: undefined,
    }, false, ["turn-pending"])).toEqual({
      session_id: "session-1",
      turn_id: "turn-pending",
    });
    // The active turn still wins over a fallback.
    expect(resolveChatCancelTarget({
      id: "session-1",
      activeTurnId: "turn-active",
    }, false, ["turn-running"])).toEqual({
      session_id: "session-1",
      turn_id: "turn-active",
    });
    // A native subagent turn is driven by its parent, never cancelled here.
    expect(resolveChatCancelTarget({
      id: "session-1",
    }, true, ["turn-running"])).toBeNull();
    // Nothing to cancel without a target.
    expect(resolveChatCancelTarget({
      id: "session-1",
    }, false, [])).toBeNull();
    expect(resolveChatCancelTarget(null, false, ["turn-running"])).toBeNull();
  });

  it("offers running and pending-send turns as cancel targets, never settled ones", () => {
    expect(resolveChatCancelFallbackTurnIds([
      { id: "turn-running", status: "running", sendState: undefined },
      { id: "turn-sending", status: "running", sendState: "pending" },
      { id: "turn-queued", status: "queued", sendState: undefined },
      { id: "turn-cancelled", status: "cancelled", sendState: "pending" },
      { id: "turn-failed", status: "error", sendState: "pending" },
      { id: "turn-done", status: "complete", sendState: undefined },
    ])).toEqual(["turn-running", "turn-sending"]);
    expect(resolveChatCancelFallbackTurnIds([])).toEqual([]);
  });

  it("builds a forked response side chat with the parent agent and cwd", () => {
    expect(resolveResponseSideChatDraft({
      active: {
        id: "parent-1",
        agent_id: "codex-acp",
        cwd: "/session",
        acp_session_id: "acp-parent",
        forkSupport: {
          level: "session",
          reason: "message-fork-not-advertised",
          message: "This agent can fork the whole session but not from a specific message.",
        },
      },
      homePath: "/home",
    })).toEqual({
      parentSessionId: "parent-1",
      parentAcpSessionId: "acp-parent",
      inheritance: "fork",
      agentId: "codex-acp",
      cwd: "/session",
    });
  });

  it("uses a fresh side chat and the home path when fork context is unavailable", () => {
    expect(resolveResponseSideChatDraft({
      active: {
        id: "parent-1",
        agent_id: "",
        cwd: "",
        acp_session_id: "",
        forkSupport: {
          level: "none",
          reason: "session-fork-not-advertised",
          message: "This agent does not support forking a session.",
        },
      },
      homePath: "/home",
    })).toEqual({
      parentSessionId: "parent-1",
      parentAcpSessionId: undefined,
      inheritance: "fresh",
      agentId: "",
      cwd: "/home",
    });
  });
});
