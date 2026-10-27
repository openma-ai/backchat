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
  useStickToBottom: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    isAtBottom: true,
  }),
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
    expect(html).toContain("shimmer-text");
  });

  it("keeps unresolved answer output visibly running", () => {
    const html = renderToStaticMarkup(
      <TurnBlock turn={runningTurn([chunk("An answer", "final_answer")])} />,
    );
    expect(html).toContain('data-thinking-fallback="true"');
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
    expect(html).not.toContain('data-thinking-fallback="true"');
  });

  it("uses the same shimmer for an atomic live thought row", () => {
    const html = renderToStaticMarkup(<TurnBlock turn={runningTurn([{
      payload: {sessionUpdate:"agent_thought_chunk",content:{type:"text",text:"Working through it"}},receivedAt:0,
    }])} />);
    expect(html).toContain('data-thought-live="true"');
    expect(html).toContain('shimmer-text');
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
    expect(html).not.toContain('data-thinking-fallback="true"');
  });

  it("keeps the collapsed waiting tool group on chat.thinking after commentary (backchat#104)", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={runningTurn([
          {
            payload: {
              sessionUpdate: "tool_call",
              toolCallId: "shell-1",
              status: "completed",
              title: "/bin/zsh -lc echo one",
              kind: "execute",
            },
            receivedAt: 1,
          },
          {
            payload: {
              sessionUpdate: "tool_call",
              toolCallId: "shell-2",
              status: "completed",
              title: "/bin/zsh -lc echo two",
              kind: "execute",
            },
            receivedAt: 2,
          },
          chunk("Interim commentary after the shells", "commentary"),
        ])}
      />,
    );

    expect(html).toContain('data-tool-group-size="2"');
    const triggerMatch = html.match(
      /data-tool-group-size="2"><button\b[^>]*data-chat-activity-disclosure-trigger="true"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(triggerMatch?.[0]).toBeDefined();
    expect(triggerMatch?.[0]).toContain("chat.thinking");
    expect(triggerMatch?.[0]).toContain('data-thinking-fallback="true"');
    expect(triggerMatch?.[0]).not.toContain("ToolSummary.execute");
    expect(html.match(/data-thinking-fallback="true"/g)).toHaveLength(1);
  });

  it("keeps toolSummary on settled historical groups, not the waiting last group", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={runningTurn([
          {
            payload: {
              sessionUpdate: "tool_call",
              toolCallId: "early-1",
              status: "completed",
              title: "/bin/zsh -lc echo early",
              kind: "execute",
            },
            receivedAt: 1,
          },
          {
            payload: {
              sessionUpdate: "tool_call",
              toolCallId: "early-2",
              status: "completed",
              title: "/bin/zsh -lc echo early-2",
              kind: "execute",
            },
            receivedAt: 2,
          },
          chunk("Between tool batches", "commentary"),
          {
            payload: {
              sessionUpdate: "tool_call",
              toolCallId: "late-1",
              status: "completed",
              title: "/bin/zsh -lc echo late",
              kind: "execute",
            },
            receivedAt: 4,
          },
          {
            payload: {
              sessionUpdate: "tool_call",
              toolCallId: "late-2",
              status: "completed",
              title: "/bin/zsh -lc echo late-2",
              kind: "execute",
            },
            receivedAt: 5,
          },
        ])}
      />,
    );

    expect(html.match(/data-tool-group-size="2"/g)).toHaveLength(2);
    const triggers = [
      ...html.matchAll(
        /data-tool-group-size="2"><button\b[^>]*data-chat-activity-disclosure-trigger="true"[^>]*>[\s\S]*?<\/button>/g,
      ),
    ].map((match) => match[0]);
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toContain("ToolSummary.execute");
    expect(triggers[0]).not.toContain('data-thinking-fallback="true"');
    expect(triggers[1]).toContain("chat.thinking");
    expect(triggers[1]).toContain('data-thinking-fallback="true"');
    expect(triggers[1]).not.toContain("ToolSummary.execute");
    expect(html.match(/data-thinking-fallback="true"/g)).toHaveLength(1);
  });

});
