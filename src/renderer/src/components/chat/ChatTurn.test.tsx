import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Turn } from "@/lib/session-store";

const sessionMock = vi.hoisted(() => ({ agentId: "" }));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key === "chat.workedFor"
        ? `worked ${String(values?.seconds)}s`
        : key,
  }),
}));

vi.mock("@/lib/session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-store")>();
  return {
    ...actual,
    useSessionStore: (selector: (store: unknown) => unknown) =>
      selector({
        get: () => ({ agent_id: sessionMock.agentId }),
        subagentsFor: () => [],
      }),
  };
});

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({
    scrollRef: { current: null },
    stopScroll: vi.fn(),
  }),
}));

import { TurnBlock } from "./ChatTurn";

function turn(overrides: Partial<Turn>): Turn {
  return {
    id: "turn-1",
    sessionId: "session-1",
    promptText: "",
    assistantText: "",
    thoughtText: "",
    status: "queued",
    events: [],
    startedAt: 1_000,
    ...overrides,
  } as Turn;
}

describe("TurnBlock", () => {
  beforeEach(() => {
    sessionMock.agentId = "";
  });

  it("shows the queued placeholder only while an empty turn is queued", () => {
    const html = renderToStaticMarkup(<TurnBlock turn={turn({})} />);

    expect(html).toContain("queued");
    expect(html).not.toContain("Turn failed.");
  });

  it("renders the broker error message for a failed turn", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "error",
          errorMessage: "The agent disconnected.",
        })}
      />,
    );

    expect(html).toContain("The agent disconnected.");
    expect(html).not.toContain(">queued<");
  });

  it("keeps ACP thought text visible after the turn completes", () => {
    const thought = "Inspecting the repository before editing.";
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          thoughtText: thought,
          endedAt: 4_600,
          events: [
            {
              payload: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: thought },
              },
              receivedAt: 1,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("worked 4s");
    expect(html).not.toContain("chat.thinking");
    expect(html).toContain(thought);
    expect(html).toContain("aria-expanded");
    expect(html).not.toContain("lucide-brain");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("bg-bg-surface");
  });

  it("does not render Reasoning before an ACP thought event arrives", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "running",
          assistantText: "Answering without hidden reasoning.",
        })}
      />,
    );

    expect(html).not.toContain("chat.thinking");
    expect(html).not.toContain("aria-expanded");
  });

  it("shows a lightweight thinking label for an empty running turn", () => {
    const html = renderToStaticMarkup(
      <TurnBlock turn={turn({ status: "running" })} />,
    );

    expect(html).toContain("Thinking");
    expect(html).toContain("text-sm");
    expect(html).toContain("thinking-placeholder-dot");
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("brand-loader-dot");
  });

  it("does not add a generic thinking heading above live activity", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "running",
          thoughtText: "Inspecting the repository.",
        })}
      />,
    );

    expect(html).not.toContain("chat.thinking");
    expect(html).not.toContain("chat.thoughtComplete");
  });

  it("keeps only one current tool activity and renders it at the bottom of the working block", () => {
    const skillPath =
      "/Users/test/.codex/plugins/cache/openai-primary-runtime/documents/1/skills/documents/SKILL.md";
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "running",
          thoughtText: "Planning the document.\n\nReading the required skill.",
          events: [
            {
              payload: {
                sessionUpdate: "agent_message_chunk",
                _meta: { codex: { phase: "commentary" } },
                content: { type: "text", text: "I will create the document." },
              },
              receivedAt: 1,
            },
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "read-1",
                kind: "read",
                status: "completed",
                title: `Read file '${skillPath}'`,
                locations: [{ path: skillPath }],
              },
              receivedAt: 2,
            },
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "read-2",
                kind: "read",
                status: "in_progress",
                title: `Read file '${skillPath}'`,
                locations: [{ path: skillPath }],
              },
              receivedAt: 3,
            },
          ],
        })}
      />,
    );

    expect(html).not.toContain("chat.thinking");
    expect(html).toContain("I will create the document.");
    expect(html.match(/读取中/g)).toHaveLength(1);
    expect(html).not.toContain(">读取<");
    expect(html).not.toContain("Planning the document.");
    expect(html.indexOf("读取中")).toBeGreaterThan(
      html.indexOf("I will create the document."),
    );
  });

  it("shows only the latest live thought status at the bottom", () => {
    sessionMock.agentId = "codex-acp";
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "running",
          thoughtText:
            "**Planning the first step**\n\n**Designing the final document**",
          events: [
            {
              payload: {
                sessionUpdate: "agent_message_chunk",
                _meta: { codex: { phase: "commentary" } },
                content: { type: "text", text: "The source is ready." },
              },
              receivedAt: 1,
            },
            {
              payload: {
                sessionUpdate: "agent_thought_chunk",
                messageId: "thought-current",
                content: {
                  type: "text",
                  text: "**Planning the first step**\n\n**Designing the final document**",
                },
              },
              receivedAt: 2,
            },
          ],
        })}
      />,
    );

    expect(html).not.toContain("Planning the first step");
    expect(html).toContain("Designing the final document");
    expect(html.indexOf("data-current-activity")).toBeGreaterThan(
      html.indexOf("The source is ready."),
    );
  });

  it("deduplicates repeated completed activity summaries", () => {
    const skillPath = "/tmp/skills/documents/SKILL.md";
    const events = ["read-1", "read-2"].map((toolCallId, index) => ({
      payload: {
        sessionUpdate: "tool_call",
        toolCallId,
        kind: "read",
        status: "completed",
        title: `Read file '${skillPath}'`,
        locations: [{ path: skillPath }],
      },
      receivedAt: index + 1,
    }));
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          events,
        })}
      />,
    );

    expect(html.match(/已读取/g)).toHaveLength(1);
  });

  it("collapses consecutive tool calls into one activity group", () => {
    const events = ["components", "renderer", "dialog"].map((target, index) => ({
      payload: {
        sessionUpdate: "tool_call",
        toolCallId: `search-${index}`,
        kind: "search",
        status: "completed",
        title: `Searched for ${target}`,
        rawInput: { query: target },
      },
      receivedAt: index + 1,
    }));
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          events,
        })}
      />,
    );

    expect(html).toContain('data-tool-group-size="3"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("components");
    expect(html).not.toContain("renderer");
  });

  it("groups tools separated only by hidden Codex thought summaries", () => {
    sessionMock.agentId = "codex-acp";
    const events = [
      {
        payload: {
          sessionUpdate: "tool_call",
          toolCallId: "run-1",
          kind: "execute",
          status: "completed",
          title: "First command",
          content: [{ type: "terminal", terminalId: "run-1" }],
        },
        receivedAt: 1,
      },
      {
        payload: {
          sessionUpdate: "agent_thought_chunk",
          messageId: "rs_between_tools",
          content: { type: "text", text: "**Planning the next command**" },
        },
        receivedAt: 2,
      },
      {
        payload: {
          sessionUpdate: "tool_call",
          toolCallId: "run-2",
          kind: "execute",
          status: "completed",
          title: "Second command",
          content: [{ type: "terminal", terminalId: "run-2" }],
        },
        receivedAt: 3,
      },
      {
        payload: {
          sessionUpdate: "agent_thought_chunk",
          messageId: "rs_between_tools_2",
          content: { type: "text", text: "**Planning the final command**" },
        },
        receivedAt: 4,
      },
      {
        payload: {
          sessionUpdate: "tool_call",
          toolCallId: "run-3",
          kind: "execute",
          status: "completed",
          title: "Third command",
          content: [{ type: "terminal", terminalId: "run-3" }],
        },
        receivedAt: 5,
      },
    ];
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "running",
          events,
        })}
      />,
    );

    expect(html).toContain('data-tool-group-size="3"');
    expect(html).not.toContain("Planning the next command");
    expect(html).not.toContain("Planning the final command");
  });

  it("shows the latest in-progress action in a running tool group", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "running",
          events: [
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "run-complete",
                kind: "execute",
                status: "completed",
                title: "Completed command",
              },
              receivedAt: 1,
            },
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "run-active",
                kind: "execute",
                status: "in_progress",
                title: "Active command",
              },
              receivedAt: 2,
            },
          ],
        })}
      />,
    );

    expect(html).toContain('data-tool-group-size="2"');
    expect(html).toContain("运行中");
    expect(html).toContain("Active command");
    expect(html).toContain("shrink-0 whitespace-nowrap");
  });

  it("uses Codex thought summaries only as a live status", () => {
    sessionMock.agentId = "codex-acp";
    const thought = "**Planning a temporary status**";
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          thoughtText: thought,
          events: [
            {
              payload: {
                sessionUpdate: "agent_thought_chunk",
                messageId: "rs_codex_reasoning",
                content: { type: "text", text: thought },
              },
              receivedAt: 1,
            },
            {
              payload: {
                sessionUpdate: "agent_message_chunk",
                _meta: { codex: { phase: "final_answer" } },
                content: { type: "text", text: "Finished." },
              },
              receivedAt: 2,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Finished.");
    expect(html).not.toContain("Planning a temporary status");
    expect(html).not.toContain("chat.thoughtComplete");
  });

  it("does not apply Codex presentation rules to another harness", () => {
    sessionMock.agentId = "pi-acp";
    const thought = "Planning from a non-Codex harness.";
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          thoughtText: thought,
          endedAt: 2_000,
          events: [
            {
              payload: {
                sessionUpdate: "agent_thought_chunk",
                messageId: "rs_looks_like_codex",
                content: { type: "text", text: thought },
              },
              receivedAt: 1,
            },
            {
              payload: {
                sessionUpdate: "agent_message_chunk",
                _meta: { codex: { phase: "commentary" } },
                content: { type: "text", text: "Harness commentary." },
              },
              receivedAt: 2,
            },
          ],
        })}
      />,
    );

    expect(html).toContain(thought);
    expect(html).toContain("Harness commentary.");
  });
});
