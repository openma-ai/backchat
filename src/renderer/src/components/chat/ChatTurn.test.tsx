import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubagentActivity, Turn } from "@/lib/session-store";

const sessionMock = vi.hoisted(() => ({
  agentId: "",
  subagents: [] as SubagentActivity[],
  commands: [] as Array<{ name: string; input?: { hint?: string } | null }>,
}));

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
        get: () => ({
          agent_id: sessionMock.agentId,
          availableCommands: sessionMock.commands,
        }),
        subagentsFor: () => sessionMock.subagents,
      }),
    sessionStore: {
      sideTabs: () => [],
      openSideTabForTask: vi.fn(),
    },
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
    sessionMock.subagents = [];
  });

  it("shows the queued placeholder only while an empty turn is queued", () => {
    const html = renderToStaticMarkup(<TurnBlock turn={turn({})} />);

    expect(html).toContain('data-session-turn-status="queued"');
    expect(html).toContain('data-session-turn-response="true"');
    expect(html).toContain("queued");
    expect(html).not.toContain("Turn failed.");
  });

  it("separates chat messages while keeping the user bubble compact", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          promptText: "A compact prompt",
          assistantText: "A clearly separated response",
          status: "complete",
        })}
      />,
    );
    const turnClass = html.match(/<article class="([^"]+)"/)?.[1] ?? "";

    expect(turnClass).toContain("!mb-8");
    expect(turnClass).toContain("!space-y-4");
    expect(turnClass).toContain(
      "[&amp;_[data-session-turn-prompt]&gt;div]:!px-3",
    );
    expect(turnClass).toContain(
      "[&amp;_[data-session-turn-prompt]&gt;div]:!py-2",
    );
  });

  it("marks assistant answer content separately from reasoning activity", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          assistantText: "FINAL_ANSWER_MARKER",
          thoughtText: "Thinking about FINAL_ANSWER_MARKER",
          status: "complete",
        })}
      />,
    );

    expect(html).toContain('data-session-turn-answer="true"');
  });

  it("renders Continue in new chat as a response action when fork is available", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          assistantText: "A completed answer",
          status: "complete",
        })}
        onFork={() => undefined}
      />,
    );

    expect(html).toContain('data-turn-fork-action="true"');
    expect(html).toContain('aria-label="chat.continueInNewChat"');
    expect(html).toContain("lucide-arrow-right-from-line");
  });

  it("does not render the response fork action without an eligible callback", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          assistantText: "A completed answer",
          status: "complete",
        })}
      />,
    );

    expect(html).not.toContain("data-turn-fork-action");
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
    const triggerClass = html.match(
      /data-slot="collapsible-trigger" class="([^"]+)"/,
    )?.[1];
    expect(triggerClass).not.toContain("sticky");
    expect(triggerClass).not.toContain("top-0");
    expect(triggerClass).not.toContain("bg-bg");
    expect(triggerClass).not.toContain("py-1");
  });

  it("renders detected native subagents as links after the activity block", () => {
    sessionMock.subagents = [
      {
        parentSessionId: "session-1",
        childSessionId: "child-a",
        viewSessionId: "native-a",
        avatarId: "1_01",
        inheritance: "fresh",
        task: "/root/a",
        status: "complete",
        startedAt: 1,
        updatedAt: 2,
        native: {
          provider: "codex",
          toolCallId: "spawn-a",
          childThreadId: "child-a",
          nickname: "a",
        },
      },
    ];
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          events: [
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "spawn-a",
                kind: "other",
                status: "completed",
                title: "Start subagent a",
              },
              receivedAt: 1,
            },
          ],
        })}
      />,
    );

    expect(html).toContain('data-subagent-links="true"');
    expect(html).toContain('data-subagent-link="native-a"');
    expect(html).toContain("Agent A");
    expect(html.indexOf('data-subagent-links="true"')).toBeGreaterThan(
      html.indexOf('data-slot="collapsible"'),
    );
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

    // No Reasoning disclosure without a thought event, and no wait line either:
    // the answer arriving is what a running turn looks like.
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("chat.thinking");
  });

  it("shows a lightweight thinking label for an empty running turn", () => {
    const html = renderToStaticMarkup(
      <TurnBlock turn={turn({ status: "running" })} />,
    );

    // The mock translator echoes keys, so this proves the placeholder is
    // localized rather than shipping a hardcoded English "Thinking" into a
    // Chinese UI. The negative assertions elsewhere use the same key to prove
    // the placeholder is gone once real thought text arrives.
    expect(html).toContain("chat.thinking");
    // The transcript's own text scale, not a size of its own: at 14px against
    // 13px body text the wait line read as a different typeface.
    expect(html).toContain("text-[13px]");
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

    // The rule is about position, not the word: no thinking heading above the
    // live activity. A trailing line below it is the documented fallback.
    expect(html).not.toContain("chat.thoughtComplete");
    const heading = html.indexOf("chat.thinking");
    if (heading >= 0) {
      expect(heading).toBeGreaterThan(html.indexOf("Inspecting the repository."));
    }
  });

  it("says nothing under an answer that is still arriving", () => {
    // "Thinking" is the fallback for a silence. While the answer streams, the
    // text is the live status, and the word under it was a second, vaguer voice
    // for the same wait.
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "running",
          assistantText: "Half a sentence so far",
        })}
      />,
    );

    // The previous form of this assertion compared indexOf() against the wait
    // line; this fixture carries no events, so the answer never rendered and
    // indexOf returned -1, which is less than anything. It proved nothing.
    expect(html).toContain('data-session-turn-status="running"');
    expect(html).not.toContain("chat.thinking");
  });

  it("stops saying it is running once the turn ends", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          assistantText: "A finished answer",
        })}
      />,
    );

    expect(html).not.toContain('data-streaming-continuation="true"');
  });

  it("shows why a turn stopped when the agent did not choose to end it", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          assistantText: "A sentence that stops mid-",
          stopReason: "max_tokens",
        })}
      />,
    );

    expect(html).toContain('data-turn-stop-reason="max_tokens"');
    expect(html).toContain("chat.stopMaxTokens");
  });

  it("says nothing about a turn the agent ended itself", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          assistantText: "A finished answer",
          stopReason: "end_turn",
        })}
      />,
    );

    expect(html).not.toContain("data-turn-stop-reason");
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

    // One live row, below what the agent said, carrying the tool that ran since.
    expect(html).toContain("I will create the document.");
    expect(html.match(/data-activity-live-work="true"/g)).toHaveLength(1);
    expect(html.indexOf('data-activity-live-work="true"')).toBeGreaterThan(
      html.indexOf("I will create the document."),
    );
    // A thought the agent has already spoken past is not what it is thinking
    // now, so it is not what the live row reports.
    expect(html).not.toContain("Planning the document.");
    expect(html).not.toContain(">读取<");
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

    // Codex sends real reasoning — headed sections, several paragraphs — and it
    // is rendered as the block it is. The policy used to drop that block and
    // squeeze the whole thing into one truncated status line. The text itself
    // streams into this surface after mount, so what static markup can prove is
    // that the block exists and that no status line duplicates it.
    expect(html).toContain('data-thought-block="true"');
    expect(html.indexOf('data-thought-block="true"')).toBeGreaterThan(
      html.indexOf("The source is ready."),
    );
    // And the live row does not echo it. The block is the first rung of the
    // ladder it degrades along, so repeating its tail underneath printed the
    // same sentence twice.
    expect(html).not.toContain("data-current-activity");
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

    expect(html.match(/tool.read/g)).toHaveLength(1);
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

  it("puts grouped and single-tool controls on the same leading column", () => {
    const events = ["components", "renderer"].map((target, index) => ({
      payload: {
        sessionUpdate: "tool_call",
        toolCallId: `search-alignment-${index}`,
        kind: "search",
        status: "completed",
        title: `Searched for ${target}`,
        rawInput: { query: target },
      },
      receivedAt: index + 1,
    }));
    const html = renderToStaticMarkup(
      <TurnBlock turn={turn({ status: "complete", events })} />,
    );
    const triggerClass = html.match(
      /data-tool-group-trigger="true"[^>]*class="([^"]+)"/,
    )?.[1];

    expect(triggerClass).toContain("activity-disclosure-row");
    expect(triggerClass).not.toContain("px-2");
    // One row height for a group, a single tool and the live status alike, so
    // folding tools into the last row cannot change where that row sits.
    expect(triggerClass).toContain("min-h-6");
    // Two per tool row — leading icon and chevron — and none for the live row
    // when it is carrying the agent's own words rather than a tool call.
    expect(html.match(/data-tool-group-icon-slot="true"/g)).toHaveLength(2);
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
    // The thoughts are rendered as blocks and the tools still group across
    // them: grouping is about what the tools are, not about what is between.
    expect(html).toContain("Planning the next command");
    expect(html).toMatch(/>[^<]*Planning the final command/);
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

    // The last row says what it is doing, not how it is doing it: the thought it
    // is working from, else the command it is running, else that it is thinking.
    // It is the agent talking, not a control — no icon before its words, and no
    // tool count after them.
    expect(html).toContain('data-tool-group-size="2"');
    expect(html).toContain('data-current-activity="Active command"');
    expect(html).not.toContain("chat.toolCallCount");
  });

  it("settles a tool call the agent stopped reporting on", () => {
    // Killing the ACP process leaves the last tool_call at in_progress, and
    // those events replay from disk unchanged. The turn is over, so nothing
    // will ever finish it — showing a spinner and "tool.running" forever is a lie.
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          events: [
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "run-killed",
                kind: "execute",
                status: "in_progress",
                title: "AGENT_BROWSER_SOCKET_DIR=/tmp/ab-wen4 agent-browser read",
              },
              receivedAt: 1,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("tool.interrupted");
    expect(html).not.toContain("tool.running");
    expect(html).toContain("AGENT_BROWSER_SOCKET_DIR=/tmp/ab-wen4 agent-browser read");
  });

  it("renders an ACP MCP extension as inspectable raw protocol data", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          events: [
            {
              payload: {
                type: "acp.mcp_notification",
                method: "mcp/resources/changed",
                params: {
                  status: "received",
                  resourceUri: "ui://example/dashboard",
                },
              },
              receivedAt: 1,
            },
          ],
        })}
      />,
    );

    expect(html).toContain('data-raw-event-kind="mcp-extension"');
    expect(html).toContain('data-raw-event-method="mcp/resources/changed"');
    expect(html).toContain('data-raw-event-type="acp.mcp_notification"');
    expect(html).toContain('data-raw-event-status="received"');
    expect(html).toContain('data-raw-event-error="none"');
    expect(html).toContain('data-raw-event-payload="true"');
    expect(html).toContain("ui://example/dashboard");
  });

  it("renders an unknown vendor event without guessing a known semantic", () => {
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          events: [
            {
              payload: {
                schema: "oma.event.v1",
                event_id: "vendor-raw-1",
                type: "vendor.event",
                session_id: "session-1",
                turn_id: "turn-1",
                source: { kind: "harness", harness: "kimi-code" },
                occurred_at: "2026-08-06T00:00:00.000Z",
                data: {
                  kind: "vendor",
                  harness: "kimi-code",
                  namespace: "acp.extension_notification",
                  name: "_kimi.dev/runtime_signal",
                  data: {
                    status: "stalled",
                    error: { code: "UPSTREAM_BUSY", message: "Try later" },
                    payloadVersion: 4,
                  },
                },
              },
              receivedAt: 1,
            },
          ],
        })}
      />,
    );

    expect(html).toContain('data-raw-event-kind="vendor-raw"');
    expect(html).toContain('data-raw-event-method="_kimi.dev/runtime_signal"');
    expect(html).toContain('data-raw-event-type="acp.extension_notification"');
    expect(html).toContain('data-raw-event-status="stalled"');
    expect(html).toContain('data-raw-event-error="present"');
    expect(html).toContain("UPSTREAM_BUSY");
    expect(html).toContain("payloadVersion");
    expect(html).not.toContain('data-tool-status="completed"');
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
    // The thought is a block of its own now; what it must not become is a
    // second disclosure with its own completion label.
    expect(html).toContain("Planning a temporary status");
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

  it("renders a Markdown plan document outside the task-list surface", () => {
    const markdown = "# Release plan\n\n1. Prepare\n2. Ship";
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          events: [
            {
              payload: {
                sessionUpdate: "plan_update",
                plan: {
                  id: "plan-1",
                  title: "Release plan",
                  content: { markdown },
                },
              },
              receivedAt: 1,
            },
          ],
        })}
      />,
    );

    expect(html).toContain('data-plan-document="true"');
    expect(html).toContain("Release plan");
    expect(html).not.toContain('data-plan-activity="true"');
  });

  it("renders Claude ExitPlanMode as a Markdown plan without a duplicate tool row", () => {
    sessionMock.agentId = "claude-acp";
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "complete",
          events: [
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "exit-plan-1",
                title: "Ready to code?",
                rawInput: {
                  plan: "# Ship the feature\n\n1. Inspect\n2. Implement",
                },
                _meta: {
                  claudeCode: { toolName: "ExitPlanMode" },
                },
              },
              receivedAt: 1,
            },
          ],
        })}
      />,
    );

    expect(html).toContain('data-plan-document="true"');
    expect(html).toContain("Ship the feature");
    expect(html).not.toContain("Ready to code?");
  });

  it.each(["opencode", "kilo"])(
    "keeps the canonical %s todo snapshot out of the transcript because the composer dock owns Plan",
    (agentId) => {
      sessionMock.agentId = agentId;
      const html = renderToStaticMarkup(
        <TurnBlock
          turn={turn({
            status: "complete",
            events: [
              {
                payload: {
                  schema_version: "oma.event.v1",
                  type: "plan.updated",
                  data: {
                    representation: "items",
                    plan_id: "todo-1",
                    update_mode: "replace",
                    entries: [
                      { content: "Inspect ACP", status: "completed" },
                      { content: "Adapt UI", status: "in_progress" },
                    ],
                  },
                },
                receivedAt: 1,
              },
            ],
          })}
        />,
      );

      expect(html).not.toContain('data-plan-activity="true"');
      expect(html).not.toContain("Inspect ACP");
      expect(html).not.toContain("Adapt UI");
    },
  );
});

describe("a prompt the composer sent as a command invocation", () => {
  beforeEach(() => {
    sessionMock.agentId = "codex-acp";
    sessionMock.commands = [
      { name: "goal", input: { hint: "[<objective>|clear|pause|resume]" } },
    ];
  });

  it("shows the objective and names the command beside it", () => {
    const html = renderToStaticMarkup(
      <TurnBlock turn={turn({ promptText: "/goal 保护世界和平", status: "complete" })} />,
    );

    // The composer added the prefix, so echoing "/goal ..." back would show
    // the user plumbing they never typed.
    expect(html).toContain("保护世界和平");
    expect(html).not.toContain("/goal");
    expect(html).toContain('data-prompt-command="goal"');
    expect(html).toContain("chat.sentAsGoal");
  });

  it("leaves an ordinary prompt untouched", () => {
    const html = renderToStaticMarkup(
      <TurnBlock turn={turn({ promptText: "保护世界和平", status: "complete" })} />,
    );

    expect(html).toContain("保护世界和平");
    expect(html).not.toContain("data-prompt-command");
  });
});

describe("Codex thinking while a tool runs", () => {
  beforeEach(() => {
    sessionMock.agentId = "codex-acp";
    sessionMock.commands = [];
  });

  it("keeps showing the latest thought instead of an empty reasoning box", () => {
    // Codex keeps no thought items in the timeline and the trigger only appears
    // once streaming stops, so suppressing this line during a tool call left
    // the block empty for the whole call.
    const html = renderToStaticMarkup(
      <TurnBlock
        turn={turn({
          status: "running",
          events: [
            {
              payload: {
                sessionUpdate: "agent_thought_chunk",
                messageId: "thought-1",
                content: { type: "text", text: "Checking the workspace first" },
              },
              receivedAt: 1,
            },
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "call-1",
                kind: "execute",
                status: "in_progress",
                title: "pwd",
              },
              receivedAt: 2,
            },
          ],
        })}
      />,
    );

    expect(html).toMatch(/>[^<]*Checking the workspace first/);
  });
});
