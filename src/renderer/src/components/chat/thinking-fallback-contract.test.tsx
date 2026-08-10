import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, language: "en" }),
}));

vi.mock("@/lib/session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-store")>();
  return {
    ...actual,
    useSessionStore: (selector: (store: unknown) => unknown) =>
      selector({
        get: () => ({ agent_id: "codex-acp" }),
        subagentsFor: () => [],
        sideTabs: () => [],
      }),
  };
});

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    stopScroll: vi.fn(),
  }),
}));

import { TurnBlock } from "./ChatTurn";
import type { Turn } from "@/lib/session-store";

/** "Thinking" is what a silence looks like: the harness is still working and
 *  none of the three things it can show — the answer, a tool, a thought — is
 *  happening. Each of those speaks for itself, so the word under any of them
 *  was a second, vaguer voice for the same wait. */
function runningTurn(events: Turn["events"]): Turn {
  return {
    id: "turn-1",
    sessionId: "session-1",
    status: "running",
    promptText: "",
    assistantText: "",
    thoughtText: "",
    startedAt: 0,
    events,
  } as Turn;
}

const chunk = (text: string, phase: string) => ({
  payload: {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
    _meta: { codex: { phase } },
  },
  receivedAt: 0,
});

describe("the thinking fallback", () => {
  it("speaks for a silence", () => {
    const html = renderToStaticMarkup(<TurnBlock turn={runningTurn([])} />);
    expect(html).toContain("chat.thinking");
  });

  it("says nothing while the answer is arriving", () => {
    const html = renderToStaticMarkup(
      <TurnBlock turn={runningTurn([chunk("An answer", "final_answer")])} />,
    );
    expect(html).not.toContain("chat.thinking");
  });

  it("says nothing while a tool is running", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={runningTurn([
          {
            payload: {
              sessionUpdate: "tool_call",
              toolCallId: "t1",
              status: "in_progress",
              title: "/bin/zsh -lc ls",
              kind: "execute",
            },
            receivedAt: 0,
          },
        ])}
      />,
    );
    expect(html).not.toContain("chat.thinking");
  });

  it("says nothing while a thought is being emitted", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={runningTurn([
          {
            payload: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "Considering the options" },
            },
            receivedAt: 0,
          },
        ])}
      />,
    );
    expect(html).not.toContain("chat.thinking");
  });
});
