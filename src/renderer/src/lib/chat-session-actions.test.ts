import { describe, expect, it } from "vitest";

import {
  resolveChatAskResponse,
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

  it("builds a forked response side chat with the parent agent and cwd", () => {
    expect(resolveResponseSideChatDraft({
      active: {
        id: "parent-1",
        agent_id: "codex-acp",
        cwd: "/session",
        acp_session_id: "acp-parent",
        supportsSessionFork: true,
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
        supportsSessionFork: false,
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
