import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/chat/ChatView", () => ({
  ChatView: () => null,
}));

import { prewarmSessionOnOpen } from "./ChatPage";
import type { SessionRow } from "@/lib/session-store";

describe("prewarmSessionOnOpen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a ready persisted session with resume data", () => {
    const sessionStart = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { backchat: { sessionStart } });

    prewarmSessionOnOpen(sessionRow());

    expect(sessionStart).toHaveBeenCalledWith({
      session_id: "sess-1",
      agent_id: "codex-acp",
      cwd: "/repo",
      resume: { acp_session_id: "acp-1" },
    });
  });

  it("does not start a fresh ACP session for rows without a resume id", () => {
    const sessionStart = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { backchat: { sessionStart } });

    prewarmSessionOnOpen(sessionRow({ acp_session_id: "" }));

    expect(sessionStart).not.toHaveBeenCalled();
  });
});

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-1",
    agent_id: "codex-acp",
    cwd: "/repo",
    acp_session_id: "acp-1",
    label: "Existing chat",
    status: "ready",
    createdAt: 1,
    ...overrides,
  };
}
