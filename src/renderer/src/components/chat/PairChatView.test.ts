import { describe, expect, it, vi } from "vitest";

import { SessionStore } from "@/lib/session-store";

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({}),
}));
vi.mock("./ChatView", () => ({ Composer: () => null }));
vi.mock("./ChatMarkdown", () => ({
  MarkdownCwdProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("./ChatTurn", () => ({ TurnBlock: () => null }));
vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: unknown }) => children,
  ConversationContent: ({ children }: { children: unknown }) => children,
  ConversationScrollButton: () => null,
}));

describe("pair chat startup latency", () => {
  it("paints the first user message before member sessions finish starting", async () => {
    const pairChatModule = await import("./PairChatView");
    const submitPairPrompt = (
      pairChatModule as unknown as {
        submitPairPrompt?: (input: Record<string, unknown>) => Promise<void>;
      }
    ).submitPairPrompt;
    expect(submitPairPrompt).toBeTypeOf("function");
    if (!submitPairPrompt) return;

    const store = new SessionStore();
    const pairId = store.newDraftPair(["pi-acp", "codex-acp"]);
    const pair = store.pair(pairId)!;
    const members = pair.members.map((sessionId) => store.get(sessionId)!);
    let resolveFirstStart!: (value: Record<string, unknown>) => void;
    const firstStart = new Promise<Record<string, unknown>>((resolve) => {
      resolveFirstStart = resolve;
    });
    const sessionStart = vi.fn()
      .mockImplementationOnce(() => firstStart)
      .mockImplementation(async ({ session_id }: { session_id: string }) => ({
        status: "ready",
        session_id,
        acp_session_id: `acp-${session_id}`,
        agent_id: store.get(session_id)?.agent_id ?? "",
        cwd: "/tmp/project",
      }));
    const sessionPrompt = vi.fn().mockResolvedValue(undefined);

    const submission = submitPairPrompt({
      store,
      pair,
      members,
      text: "Compare approaches",
      displayText: "Compare approaches",
      attachments: [],
      sessionReferences: [],
      sessionStart,
      sessionPrompt,
    });

    for (const member of members) {
      expect(store.turnsFor(member.id)).toMatchObject([
        { promptText: "Compare approaches", status: "running" },
      ]);
    }
    expect(sessionPrompt).not.toHaveBeenCalled();

    resolveFirstStart({
      status: "ready",
      session_id: members[0]!.id,
      acp_session_id: `acp-${members[0]!.id}`,
      agent_id: members[0]!.agent_id,
      cwd: "/tmp/project",
    });
    await submission;

    expect(sessionPrompt).toHaveBeenCalledTimes(2);
  });

  it("settles a failed member without blocking delivery to the others", async () => {
    const pairChatModule = await import("./PairChatView");
    const submitPairPrompt = (
      pairChatModule as unknown as {
        submitPairPrompt: (input: Record<string, unknown>) => Promise<void>;
      }
    ).submitPairPrompt;
    const store = new SessionStore();
    const pairId = store.newDraftPair(["pi-acp", "codex-acp"]);
    const pair = store.pair(pairId)!;
    const members = pair.members.map((sessionId) => store.get(sessionId)!);
    const sessionStart = vi.fn()
      .mockResolvedValueOnce({
        status: "error",
        session_id: members[0]!.id,
        message: "Pi failed to start",
      })
      .mockResolvedValueOnce({
        status: "ready",
        session_id: members[1]!.id,
        acp_session_id: `acp-${members[1]!.id}`,
        agent_id: members[1]!.agent_id,
        cwd: "/tmp/project",
      });
    const sessionPrompt = vi.fn().mockResolvedValue(undefined);

    await submitPairPrompt({
      store,
      pair,
      members,
      text: "Compare approaches",
      displayText: "Compare approaches",
      attachments: [],
      sessionReferences: [],
      sessionStart,
      sessionPrompt,
    });

    expect(store.turnsFor(members[0]!.id)[0]).toMatchObject({
      status: "error",
      errorMessage: "Pi failed to start",
    });
    expect(sessionPrompt).toHaveBeenCalledOnce();
    expect(sessionPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: members[1]!.id }),
    );

    const successfulTurn = store.turnsFor(members[1]!.id)[0]!;
    store.apply({
      type: "session.complete",
      session_id: members[1]!.id,
      turn_id: successfulTurn.id,
    });
    expect(store.pair(pairId)?.activeTurnId).toBeUndefined();
  });
});
