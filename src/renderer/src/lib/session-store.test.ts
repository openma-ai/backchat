import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SessionStore,
  selectSessions,
  selectTurnsFor,
  type AcpSessionConfigOption,
  type SubagentActivity,
} from "./session-store";
import { reduceTurn } from "./reduce-turn";

describe("session store module boundaries", () => {
  test("keeps public data contracts in a dedicated type module", () => {
    const source = readFileSync(resolve(__dirname, "session-store.ts"), "utf8");

    expect(source).toContain('from "./session-types"');
    expect(source).not.toContain("export interface SessionRow {");
    expect(source).not.toContain("export interface Turn {");
  });

  test("delegates workspace artifact parsing to a pure helper module", () => {
    const source = readFileSync(resolve(__dirname, "session-store.ts"), "utf8");

    expect(source).toContain('from "./session-artifacts"');
    expect(source).not.toContain("function extractFilePaths(");
    expect(source).not.toContain("function extractServiceUrls(");
  });

  test("delegates persisted side workspace normalization to a pure helper module", () => {
    const source = readFileSync(resolve(__dirname, "session-store.ts"), "utf8");

    expect(source).toContain('from "./session-workspace-normalization"');
    expect(source).not.toContain("function normalizeRestoredSideSession(");
    expect(source).not.toContain("function isPersistedSideTab(");
  });

  test("delegates native subagent status and provider mapping to a pure helper module", () => {
    const source = readFileSync(resolve(__dirname, "session-store.ts"), "utf8");

    expect(source).toContain('from "./session-native-activity"');
    expect(source).not.toContain("function nativeActivityTurnStatus(");
    expect(source).not.toContain("function nativeProviderForAgent(");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const initialConfig: AcpSessionConfigOption[] = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "sonnet",
    options: [{ value: "sonnet", name: "Claude Sonnet" }],
  },
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: "code",
    options: [{ value: "code", name: "Code" }],
  },
];

describe("SessionStore replay", () => {
  test("restores the latest session metadata and usage from history", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-replay-metadata",
      acp_session_id: "acp-replay-metadata",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });

    store.replayHistory("sess-replay-metadata", [
      {
        seq: 1,
        type: "session_info_update",
        data: JSON.stringify({
          sessionUpdate: "session_info_update",
          title: "Restored title",
          _meta: { codex: { threadStatus: { type: "idle" } } },
        }),
        ts: 1000,
      },
      {
        seq: 2,
        type: "usage_update",
        data: JSON.stringify({
          sessionUpdate: "usage_update",
          used: 80,
          size: 100,
        }),
        ts: 1001,
      },
    ]);

    expect(store.get("sess-replay-metadata")).toMatchObject({
      label: "Restored title",
      agentThreadStatus: "idle",
      usage: { used: 80, size: 100 },
    });
    expect(store.turnsFor("sess-replay-metadata")).toEqual([]);
  });

  test("replays persisted assistant chunks exactly once", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-history-dedupe";

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Generate an image" }),
        ts: 1000,
      },
      {
        seq: 2,
        type: "agent_message_chunk",
        data: JSON.stringify({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Rendered " },
        }),
        ts: 1001,
      },
      {
        seq: 3,
        type: "agent_message_chunk",
        data: JSON.stringify({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "once." },
        }),
        ts: 1002,
      },
    ]);

    expect(store.turnsFor(sessionId)).toHaveLength(1);
    expect(store.turnsFor(sessionId)[0]?.assistantText).toBe("Rendered once.");
  });

  test("restores a turn's end time from its final persisted event", () => {
    const store = new SessionStore();
    const sessionId = "sess-replay-duration";

    store.replayHistory(sessionId, [
      {
        seq: 1,
        type: "user_prompt",
        data: JSON.stringify({ text: "Do some work" }),
        ts: 1_000,
      },
      {
        seq: 2,
        type: "agent_message_chunk",
        data: JSON.stringify({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Done." },
        }),
        ts: 4_600,
      },
    ]);

    expect(store.turnsFor(sessionId)[0]).toMatchObject({
      startedAt: 1_000,
      endedAt: 4_600,
    });
  });
});

describe("SessionStore performance invariants", () => {
  test("shows Codex skill-context warnings as expiring session notices", async () => {
    vi.useFakeTimers();
    try {
      const store = new SessionStore();
      store.registerStarting("sess-warning", "codex-acp", "Codex");
      store.registerTurn("turn-warning", "sess-warning", "hello");
      const warning =
        "Warning: Skill descriptions were shortened to fit the 2% skills context budget. " +
        "Codex can still see every skill, but some descriptions are shorter.";

      store.apply({
        type: "session.event",
        session_id: "sess-warning",
        turn_id: "turn-warning",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `${warning}\n\n` },
        },
      });

      expect(store.get("sess-warning")?.notice).toMatchObject({
        message: warning,
        tone: "warning",
      });
      expect(store.turnsFor("sess-warning")[0]?.assistantText).toBe("");

      await vi.advanceTimersByTimeAsync(9_999);
      expect(store.get("sess-warning")?.notice).toBeDefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(store.get("sess-warning")?.notice).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("reuses collection snapshots when an unrelated store slice changes", () => {
    const store = new SessionStore();
    store.registerStarting("sess-1", "codex-acp", "First");
    store.registerTurn("turn-1", "sess-1", "hello");
    const turnsSelector = selectTurnsFor("sess-1");

    const sessionsBefore = store.snapshot(selectSessions);
    const turnsBefore = store.snapshot(turnsSelector);

    store.setSideActive("unrelated-side-session");

    expect(store.snapshot(selectSessions)).toBe(sessionsBefore);
    expect(store.snapshot(turnsSelector)).toBe(turnsBefore);

    store.registerTurn("turn-2", "sess-1", "changed");
    expect(store.snapshot(turnsSelector)).not.toBe(turnsBefore);
  });

  test("coalesces adjacent streaming chunks without losing tool boundaries", () => {
    const store = new SessionStore();
    store.registerStarting("sess-1", "codex-acp", "First");
    store.registerTurn("turn-1", "sess-1", "hello");
    const firstRun = Array.from({ length: 500 }, (_, i) => `a${i};`);
    const secondRun = Array.from({ length: 500 }, (_, i) => `b${i};`);

    for (const text of firstRun) {
      store.apply({
        type: "session.event",
        session_id: "sess-1",
        turn_id: "turn-1",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
    }
    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read file",
        status: "completed",
      },
    });
    for (const text of secondRun) {
      store.apply({
        type: "session.event",
        session_id: "sess-1",
        turn_id: "turn-1",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
    }

    const turn = store.turnsFor("sess-1")[0]!;
    expect(turn.assistantText).toBe(firstRun.join("") + secondRun.join(""));
    expect(turn.events).toHaveLength(3);
  });

  test("publishes trailing final-answer events when a turn completes after its last tool", () => {
    const store = new SessionStore();
    const sessionId = "sess-final-after-tool";
    const turnId = "turn-final-after-tool";
    const selector = selectTurnsFor(sessionId);
    store.registerStarting(sessionId, "codex-acp", "Codex");
    store.registerTurn(turnId, sessionId, "create a document");

    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-render",
        title: "View rendered document",
        status: "completed",
      },
    });
    const eventsPublishedAtTool = store.snapshot(selector)[0]!.events;

    for (const text of ["Created ", "the document."]) {
      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-final",
          _meta: { codex: { phase: "final_answer" } },
          content: { type: "text", text },
        },
      });
    }
    store.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: turnId,
    });

    const completed = store.snapshot(selector)[0]!;
    expect(completed.events).not.toBe(eventsPublishedAtTool);
    expect(reduceTurn(completed.events).timeline.at(-1)).toEqual({
      kind: "assistant_text",
      phase: "final_answer",
      text: "Created the document.",
    });
  });

  test("publishes only the first thought chunk so the Reasoning block can mount", () => {
    const store = new SessionStore();
    store.registerStarting("sess-thought", "pi-acp", "Pi");
    store.registerTurn("turn-thought", "sess-thought", "inspect this");
    const turnsSelector = selectTurnsFor("sess-thought");
    const beforeSnapshot = store.snapshot(turnsSelector);
    const beforeThought = store.getVersion();

    store.apply({
      type: "session.event",
      session_id: "sess-thought",
      turn_id: "turn-thought",
      event: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "First" },
      },
    });
    const afterFirstThought = store.getVersion();
    const afterFirstSnapshot = store.snapshot(turnsSelector);

    store.apply({
      type: "session.event",
      session_id: "sess-thought",
      turn_id: "turn-thought",
      event: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: " second" },
      },
    });
    const afterSecondSnapshot = store.snapshot(turnsSelector);

    expect(afterFirstThought).toBe(beforeThought + 1);
    expect(store.getVersion()).toBe(afterFirstThought);
    expect(afterFirstSnapshot).not.toBe(beforeSnapshot);
    expect(afterSecondSnapshot).toBe(afterFirstSnapshot);
  });

  test("publishes the first assistant chunk so the streaming answer can mount", () => {
    const store = new SessionStore();
    store.registerStarting("sess-answer", "codex-acp", "Codex");
    store.registerTurn("turn-answer", "sess-answer", "answer this");
    const turnsSelector = selectTurnsFor("sess-answer");
    const beforeSnapshot = store.snapshot(turnsSelector);
    const beforeVersion = store.getVersion();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.apply({
      type: "session.event",
      session_id: "sess-answer",
      turn_id: "turn-answer",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "First visible token" },
      },
    });

    const afterFirstSnapshot = store.snapshot(turnsSelector);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getVersion()).toBe(beforeVersion + 1);
    expect(afterFirstSnapshot).not.toBe(beforeSnapshot);
    expect(afterFirstSnapshot[0]?.assistantText).toBe("First visible token");

    unsubscribe();
  });

  test("preserves message identity and Codex phase while compacting stream chunks", () => {
    const store = new SessionStore();
    store.registerStarting("sess-phase", "codex-acp", "Codex");
    store.registerTurn("turn-phase", "sess-phase", "inspect this");

    for (const text of ["Checking ", "files"]) {
      store.apply({
        type: "session.event",
        session_id: "sess-phase",
        turn_id: "turn-phase",
        event: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg-commentary",
          _meta: { codex: { phase: "commentary" } },
          content: { type: "text", text },
        },
      });
    }

    const [event] = store.turnsFor("sess-phase")[0]!.events;
    expect(event?.payload).toMatchObject({
      sessionUpdate: "agent_message_chunk",
      messageId: "msg-commentary",
      _meta: { codex: { phase: "commentary" } },
      content: { type: "text", text: "Checking files" },
    });
  });

  test("publishes each new Codex thought message as a replaceable tail status", () => {
    const store = new SessionStore();
    store.registerStarting("sess-codex-thought", "codex-acp", "Codex");
    store.registerTurn(
      "turn-codex-thought",
      "sess-codex-thought",
      "inspect this",
    );
    const selector = selectTurnsFor("sess-codex-thought");

    store.apply({
      type: "session.event",
      session_id: "sess-codex-thought",
      turn_id: "turn-codex-thought",
      event: {
        sessionUpdate: "agent_thought_chunk",
        messageId: "rs-one",
        content: { type: "text", text: "Planning one" },
      },
    });
    const firstSnapshot = store.snapshot(selector);

    store.apply({
      type: "session.event",
      session_id: "sess-codex-thought",
      turn_id: "turn-codex-thought",
      event: {
        sessionUpdate: "agent_thought_chunk",
        messageId: "rs-two",
        content: { type: "text", text: "Planning two" },
      },
    });
    const secondSnapshot = store.snapshot(selector);

    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot[0]?.events).toHaveLength(2);
    expect(secondSnapshot[0]?.activeThoughtMessageId).toBe("rs-two");
    expect(secondSnapshot[0]?.activeThoughtSegmentText).toBe("Planning two");
  });
});

describe("SessionStore task side workspace persistence", () => {
  test("round-trips each task's tabs, active surface, artifacts, and native child view", () => {
    const source = new SessionStore();
    source.apply({
      type: "session.ready",
      session_id: "task-a",
      acp_session_id: "acp-task-a",
      agent_id: "codex-acp",
      cwd: "/repo-a",
    });
    source.registerTurn("turn-a", "task-a", "Build the page");
    source.apply({
      type: "session.event",
      session_id: "task-a",
      turn_id: "turn-a",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "write-a",
        title: "Write file",
        status: "completed",
        rawInput: { path: "/repo-a/index.html" },
        rawOutput: "Preview: http://localhost:4173",
      },
    });
    source.openSideTabForTask(
      "task-a",
      "browser",
      "http://localhost:4173/dashboard",
      "Dashboard",
      "browser-a",
    );
    source.patchSideTabForTask("task-a", "browser-a", {
      faviconUrl: "https://example.test/favicon.ico",
    });
    source.openSideTabForTask("task-a", "file", "/repo-a/src", "src", "files-a");
    source.openSideTabForTask("task-a", "terminal", "pty-dead", "repo-a", "term-a");
    source.patchSideTabForTask("task-a", "term-a", { terminalCwd: "/repo-a" });
    source.setActiveSideTabForTask("task-a", "browser-a");

    source.apply({
      type: "session.event",
      session_id: "task-a",
      turn_id: "turn-a",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "spawn-a",
        toolName: "spawn_agent",
        status: "completed",
        rawInput: { message: "Audit the layout" },
        rawOutput: { agent_id: "child-a", nickname: "Layout audit" },
      },
    });
    source.apply({
      type: "session.event",
      session_id: "task-a",
      turn_id: "turn-a",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "wait-a",
        toolName: "wait_agent",
        status: "completed",
        rawInput: { targets: ["child-a"] },
        rawOutput: { status: { "child-a": { completed: "Looks good." } } },
      },
    });

    const snapshots = source.sideWorkspaceSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      taskId: "task-a",
      state: {
        version: 1,
        activeTabId: expect.any(String),
        activeBrowserTabId: "browser-a",
        artifacts: {
          files: expect.arrayContaining(["/repo-a/index.html"]),
          services: expect.arrayContaining(["http://localhost:4173"]),
        },
      },
    });

    const restored = new SessionStore();
    restored.apply({
      type: "session.ready",
      session_id: "task-a",
      acp_session_id: "acp-task-a",
      agent_id: "codex-acp",
      cwd: "/repo-a",
    });
    restored.hydrateSideWorkspaces(snapshots);
    restored.setActive("task-a");

    expect(restored.sideTabs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser-a",
          payload: "http://localhost:4173/dashboard",
          faviconUrl: "https://example.test/favicon.ico",
        }),
        expect.objectContaining({ id: "files-a", payload: "/repo-a/src" }),
        expect.objectContaining({
          id: "term-a",
          type: "terminal",
          payload: "",
          terminalCwd: "/repo-a",
          needsRestore: true,
        }),
        expect.objectContaining({ type: "subagent", label: "Layout audit" }),
      ]),
    );
    expect(restored.activeSideTabId()).toBe(snapshots[0]!.state.activeTabId);
    expect(restored.browserWindows()[0]?.activeTabId).toBe("browser-a");
    expect(restored.artifactsFor("task-a")).toMatchObject({
      files: expect.arrayContaining(["/repo-a/index.html"]),
      services: expect.arrayContaining(["http://localhost:4173"]),
    });

    const child = restored.subagentsFor("task-a")[0]!;
    expect(child).toMatchObject({ childSessionId: "child-a", status: "complete" });
    expect(restored.turnsFor(child.viewSessionId)).toEqual([
      expect.objectContaining({
        promptText: "Audit the layout",
        assistantText: "Looks good.",
        status: "complete",
      }),
    ]);
  });
});

describe("SessionStore config options", () => {
  test("stores initial ACP config options from session.ready", () => {
    const store = new SessionStore();

    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });

    expect(store.get("sess-1")?.configOptions).toEqual(initialConfig);
    expect(store.get("sess-1")?.currentModeId).toBe("code");
  });

  test("drops malformed session.ready options with the canonical validator", () => {
    const store = new SessionStore();

    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: [
        {
          id: "telemetry",
          name: "Telemetry",
          type: "boolean",
          currentValue: false,
        },
        {
          id: "broken-model",
          name: "Broken model",
          type: "select",
          currentValue: "opus",
          options: [{ value: "opus" }],
        },
      ],
    });

    expect(store.get("sess-1")?.configOptions).toEqual([
      {
        id: "telemetry",
        name: "Telemetry",
        type: "boolean",
        currentValue: false,
      },
    ]);
  });

  test("replaces config options from config_option_update", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });

    const updated: AcpSessionConfigOption[] = [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "opus",
        options: [
          { value: "sonnet", name: "Claude Sonnet" },
          { value: "opus", name: "Claude Opus" },
        ],
      },
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "review",
        options: [
          { value: "code", name: "Code" },
          { value: "review", name: "Review" },
        ],
      },
    ];

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: updated,
      },
    });

    expect(store.get("sess-1")?.configOptions).toEqual(updated);
    expect(store.get("sess-1")?.currentModeId).toBe("review");
  });

  test("patches existing rows with persisted creation time", () => {
    const store = new SessionStore();
    store.registerStarting("sess-1", "claude-acp", "Draft label");

    store.seedPersisted([
      {
        id: "sess-1",
        agent_id: "claude-acp",
        cwd: "/tmp/project",
        acp_session_id: "acp-1",
        title: "Persisted label",
        last_used_at: 456,
        created_at: 123,
      },
    ]);

    expect(store.get("sess-1")?.createdAt).toBe(123);
  });

  test("stores session-scoped config option updates without a turn", () => {
    const store = new SessionStore();
    const sessionId = "sess-config-option-update";
    store.registerStarting(sessionId, "codex-acp", "Config test");

    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: "",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-5",
            options: [{ value: "gpt-5", name: "GPT-5" }],
          },
        ],
      },
    });

    expect(store.get(sessionId)?.configOptions?.[0]?.currentValue).toBe("gpt-5");
  });
});

describe("SessionStore ACP session metadata", () => {
  test("adapts usage updates without creating a transcript turn", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-usage",
      acp_session_id: "acp-usage",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });

    store.apply({
      type: "session.event",
      session_id: "sess-usage",
      turn_id: "turn-does-not-exist",
      event: {
        sessionUpdate: "usage_update",
        used: 206_720,
        size: 258_400,
        cost: { amount: 0.42, currency: "USD" },
      },
    });

    expect(store.get("sess-usage")?.usage).toEqual({
      used: 206_720,
      size: 258_400,
      cost: { amount: 0.42, currency: "USD" },
    });
    expect(store.turnsFor("sess-usage")).toEqual([]);
  });

  test("preserves the last valid usage when a malformed update arrives", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-usage",
      acp_session_id: "acp-usage",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.apply({
      type: "session.event",
      session_id: "sess-usage",
      turn_id: "turn-1",
      event: { sessionUpdate: "usage_update", used: 10, size: 100 },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-usage",
      turn_id: "turn-1",
      event: { sessionUpdate: "usage_update", used: -1, size: 0 },
    });

    expect(store.get("sess-usage")?.usage).toEqual({ used: 10, size: 100 });
  });

  test("merges session info while keeping the local turn lifecycle authoritative", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-info",
      acp_session_id: "acp-info",
      agent_id: "codex-acp",
      cwd: "/tmp/project",
    });
    store.apply({
      type: "session.event",
      session_id: "sess-info",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "session_info_update",
        title: "Agent supplied title",
        updatedAt: "2026-07-18T10:00:00.000Z",
        _meta: {
          codex: {
            threadStatus: { type: "active" },
            stableValue: true,
          },
        },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-info",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "session_info_update",
        _meta: { codex: { threadStatus: { type: "idle" } } },
      },
    });

    expect(store.get("sess-info")).toMatchObject({
      label: "Agent supplied title",
      status: "ready",
      sessionUpdatedAt: "2026-07-18T10:00:00.000Z",
      agentThreadStatus: "idle",
      sessionInfoMeta: {
        codex: {
          threadStatus: { type: "idle" },
          stableValue: true,
        },
      },
    });
    expect(store.turnsFor("sess-info")).toEqual([]);
  });
});

describe("SessionStore project drafts", () => {
  test("binds a project cwd when the draft is created", () => {
    const store = new SessionStore();

    const id = store.newDraft("/work/project-a");

    expect(store.get(id)).toMatchObject({
      status: "draft",
      chosenCwd: "/work/project-a",
      projectScope: "project",
    });
    expect(store.active()?.id).toBe(id);
  });

  test("marks a global draft as explicitly outside projects", () => {
    const store = new SessionStore();

    const id = store.newDraft();

    expect(store.get(id)).toMatchObject({
      status: "draft",
      projectScope: "none",
    });
  });

  test("does not restore untitled pre-prompt shells as ghost chats", () => {
    const store = new SessionStore();

    store.seedPersisted([
      {
        id: "legacy-empty",
        agent_id: "codex-acp",
        cwd: "/work/project-a",
        acp_session_id: "acp-empty",
        title: "",
        last_used_at: 1,
        created_at: 1,
      },
    ]);

    expect(store.get("legacy-empty")).toBeUndefined();
  });
});

describe("SessionStore event reducers", () => {
  test("accepts wrapped ACP chunk events on the streaming accumulators", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });
    store.registerTurn("turn-1", "sess-1", "hello");

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionId: "acp-1",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Thinking" },
        },
      },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionId: "acp-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "PONG" },
        },
      },
    });

    const turn = store.turnsFor("sess-1")[0];
    expect(turn?.thoughtText).toBe("Thinking");
    expect(turn?.assistantText).toBe("PONG");
  });

  test("accepts bare OpenMA chunk events on the streaming accumulators", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });
    store.registerTurn("turn-1", "sess-1", "hello");

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: { type: "agent.thinking_chunk", delta: "Checking" },
    });
    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: { type: "agent.message_chunk", delta: "Done" },
    });

    const turn = store.turnsFor("sess-1")[0];
    expect(turn?.thoughtText).toBe("Checking");
    expect(turn?.assistantText).toBe("Done");
  });

});

describe("SessionStore slash commands", () => {
  test("stores ACP availableCommands updates for the composer slash picker", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "",
      event: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "web",
            description: "Search the web for information",
            input: { hint: "query to search for" },
          },
          {
            name: "test",
            description: "Run tests for the current project",
          },
        ],
      },
    });

    expect(store.get("sess-1")?.availableCommands).toEqual([
      {
        name: "web",
        description: "Search the web for information",
        input: { hint: "query to search for" },
      },
      {
        name: "test",
        description: "Run tests for the current project",
      },
    ]);
  });

  test("accepts snake_case available command updates", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-1",
      acp_session_id: "acp-1",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
      config_options: initialConfig,
    });

    store.apply({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "",
      event: {
        sessionUpdate: "available_commands_update",
        available_commands: [
          { name: "review", description: "Review the current workspace" },
          { name: "render", input: { hint: "scene id" } },
        ],
      },
    });

    expect(store.get("sess-1")?.availableCommands).toEqual([
      { name: "review", description: "Review the current workspace" },
      { name: "render", input: { hint: "scene id" } },
    ]);
  });
});

describe("SessionStore prompt queue state", () => {
  test("deduplicates broker asks and clears them when the active turn terminates", () => {
    const store = new SessionStore();
    const sessionId = "sess-broker-lifecycle";
    store.registerStarting(sessionId, "codex-acp", "Approval test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-broker-lifecycle",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-active", sessionId, "run it");
    const brokerAsk = {
      kind: "permission" as const,
      ask: {
        requestId: "permission-1",
        sessionId,
        toolCall: { title: "Run command" },
        options: [
          {
            optionId: "cancel",
            name: "Cancel",
            kind: "reject_once" as const,
          },
        ],
      },
    };

    store.enqueueAsk(sessionId, brokerAsk);
    store.enqueueAsk(sessionId, brokerAsk);
    expect(store.get(sessionId)?.pendingAsks).toEqual([brokerAsk]);

    store.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-active",
    });
    expect(store.get(sessionId)?.pendingAsks).toBeUndefined();
  });

  test("retains an approval that arrives before its session row is restored", () => {
    const store = new SessionStore();
    const sessionId = "sess-late-restore";
    const brokerAsk = {
      kind: "permission" as const,
      ask: {
        requestId: "permission-before-ready",
        sessionId,
        toolCall: { title: "Run command" },
        options: [
          {
            optionId: "allow",
            name: "Allow",
            kind: "allow_once" as const,
          },
        ],
      },
    };

    store.enqueueAsk(sessionId, brokerAsk);
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-late-restore",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    expect(store.get(sessionId)?.pendingAsks).toEqual([brokerAsk]);
  });

  test("keeps the active turn running and marks later turns queued", () => {
    const store = new SessionStore();
    const sessionId = "sess-queue-state";
    store.registerStarting(sessionId, "codex-acp", "Queue test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-queue-state",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    store.registerTurn("turn-active", sessionId, "first");
    store.registerTurn("turn-queued", sessionId, "second");

    expect(store.get(sessionId)?.activeTurnId).toBe("turn-active");
    expect(store.get(sessionId)?.queuedTurnIds).toEqual(["turn-queued"]);
    expect(store.turnsFor(sessionId).map((turn) => turn.status)).toEqual([
      "running",
      "queued",
    ]);

    store.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-active",
    });

    expect(store.get(sessionId)?.activeTurnId).toBe("turn-queued");
    expect(store.get(sessionId)?.status).toBe("running");
    expect(store.turnsFor(sessionId).map((turn) => turn.status)).toEqual([
      "complete",
      "running",
    ]);

    store.apply({
      type: "session.complete",
      session_id: sessionId,
      turn_id: "turn-queued",
    });

    expect(store.get(sessionId)?.activeTurnId).toBeUndefined();
    expect(store.get(sessionId)?.status).toBe("ready");
  });

  test("queues llm-boundary steer turns behind the active turn", () => {
    const store = new SessionStore();
    const sessionId = "sess-queue-delivery";
    store.registerStarting(sessionId, "codex-acp", "Queue delivery test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-queue-delivery",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    store.registerTurn("turn-active-delivery", sessionId, "first", {
      intent: "submit",
      requestedDelivery: "turn_end",
      effectiveDelivery: "turn_end",
      degraded: false,
    });
    store.registerTurn("turn-steer", sessionId, "steer me", {
      intent: "steer",
      requestedDelivery: "llm_boundary",
      effectiveDelivery: "turn_end",
      degraded: true,
    });

    const steer = store
      .turnsFor(sessionId)
      .find((turn) => turn.id === "turn-steer");

    expect(steer?.status).toBe("queued");
    expect(steer?.promptIntent).toBe("steer");
    expect(steer?.requestedDelivery).toBe("llm_boundary");
    expect(steer?.effectiveDelivery).toBe("turn_end");
    expect(steer?.deliveryDegraded).toBe(true);
    expect(store.get(sessionId)?.activeTurnId).toBe("turn-active-delivery");
    expect(store.get(sessionId)?.queuedTurnIds).toEqual(["turn-steer"]);
  });

  test("applies main-process queue snapshots", () => {
    const store = new SessionStore();
    const sessionId = "sess-main-queue";
    store.registerStarting(sessionId, "codex-acp", "Queue snapshot test");
    store.apply({
      type: "session.ready",
      session_id: sessionId,
      acp_session_id: "acp-main-queue",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    store.apply({
      type: "session.queue_update",
      session_id: sessionId,
      mode: "single",
      active_turn_id: "turn-active",
      queued: [{ turn_id: "turn-next", text: "next", created_at: 123 }],
    });

    expect(store.get(sessionId)?.activeTurnId).toBe("turn-active");
    expect(store.get(sessionId)?.queuedPrompts).toEqual([
      { turn_id: "turn-next", text: "next", created_at: 123 },
    ]);
  });
});

describe("SessionStore side chats and native subagents", () => {
  test("stores fork capability from session.ready events", () => {
    const store = new SessionStore();

    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-acp",
      agent_id: "codex-acp",
      cwd: "/repo",
      supports_session_fork: true,
    });

    expect(store.get("parent-session")?.supportsSessionFork).toBe(true);
  });

  test("opens a subordinate side chat with fork inheritance", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-acp",
      agent_id: "codex-acp",
      cwd: "/repo",
      supports_session_fork: true,
    });

    const childId = store.newSideDraft({
      parentSessionId: "parent-session",
      parentAcpSessionId: "parent-acp",
      inheritance: "fork",
      agentId: "codex-acp",
      cwd: "/repo",
    });
    store.openSideTab("chat", childId, "Side chat");

    expect(store.get(childId)).toMatchObject({
      kind: "side",
      sideKind: "chat",
      agent_id: "codex-acp",
      cwd: "/repo",
      sideParent: {
        parentSessionId: "parent-session",
        parentAcpSessionId: "parent-acp",
        inheritance: "fork",
      },
    });
    expect(store.activeSideTab()?.type).toBe("chat");
    expect(store.sideActiveId()).toBe(childId);
  });

  test("promotes a side chat into an independent fork", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-acp",
      agent_id: "codex-acp",
      cwd: "/repo",
      supports_session_fork: true,
    });
    const childId = store.newSideDraft({
      parentSessionId: "parent-session",
      parentAcpSessionId: "parent-acp",
      inheritance: "fork",
      agentId: "codex-acp",
      cwd: "/repo",
    });
    store.openSideTab("chat", childId, "Side chat");

    expect(store.promoteSideToMain(childId)).toBe(childId);

    expect(store.get(childId)).toMatchObject({
      kind: "main",
      sideKind: undefined,
      sideParent: undefined,
    });
    expect(store.activeId()).toBe(childId);
    expect(store.sideActiveId()).toBeNull();
    expect(store.activeSideTab()).toBeNull();
  });

  test("keeps an independent multi-tab browser window for each task", () => {
    const store = new SessionStore();
    for (const sessionId of ["task-a", "task-b"]) {
      store.apply({
        type: "session.ready",
        session_id: sessionId,
        acp_session_id: `acp-${sessionId}`,
        agent_id: "codex-acp",
        cwd: "/repo",
      });
    }

    store.openSideTabForTask(
      "task-a",
      "browser",
      "https://a.example/one",
      "A one",
      "browser-a-1",
    );
    store.openSideTabForTask(
      "task-a",
      "browser",
      "https://a.example/two",
      "A two",
      "browser-a-2",
    );
    store.openSideTabForTask(
      "task-b",
      "browser",
      "https://b.example/one",
      "B one",
      "browser-b-1",
    );

    expect(store.browserWindows()).toEqual([
      {
        taskId: "task-a",
        activeTabId: "browser-a-2",
        tabs: [
          expect.objectContaining({ id: "browser-a-1", payload: "https://a.example/one" }),
          expect.objectContaining({ id: "browser-a-2", payload: "https://a.example/two" }),
        ],
      },
      {
        taskId: "task-b",
        activeTabId: "browser-b-1",
        tabs: [
          expect.objectContaining({ id: "browser-b-1", payload: "https://b.example/one" }),
        ],
      },
    ]);

    store.setActiveSideTabForTask("task-a", "browser-a-1");
    expect(store.browserWindows()[0]?.activeTabId).toBe("browser-a-1");
    expect(store.browserWindows()[1]?.activeTabId).toBe("browser-b-1");
  });

  test("task browser opens are idempotent for a tool-provided tab id", () => {
    const store = new SessionStore();
    store.openSideTabForTask(
      "task-a",
      "browser",
      "about:blank",
      "New tab",
      "browser-tool-tab",
    );
    store.openSideTabForTask(
      "task-a",
      "browser",
      "https://example.com",
      "Example",
      "browser-tool-tab",
    );

    const window = store.browserWindows()[0];
    expect(window?.tabs).toHaveLength(1);
    expect(window?.tabs[0]).toMatchObject({
      id: "browser-tool-tab",
      payload: "https://example.com",
      label: "Example",
    });
  });

  test("tracks Codex native multi-agent tool calls as parent subagent activity", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-codex-thread",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "parent-session", "Ask a native Codex subagent");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "call-spawn",
        toolName: "spawn_agent",
        status: "completed",
        rawInput: {
          agent_type: "default",
          fork_context: false,
          message: "Review the auth boundary",
        },
        rawOutput: JSON.stringify({
          agent_id: "codex-child-thread",
          nickname: "Cicero",
        }),
      },
    });

    expect(store.subagentsFor("parent-session")).toEqual([
      expect.objectContaining({
        childSessionId: "codex-child-thread",
        parentSessionId: "parent-session",
        parentAcpSessionId: "parent-codex-thread",
        inheritance: "fresh",
        task: "Review the auth boundary",
        status: "running",
        native: expect.objectContaining({
          provider: "codex",
          toolCallId: "call-spawn",
          childThreadId: "codex-child-thread",
          nickname: "Cicero",
          agentType: "default",
          forkContext: false,
        }),
      }),
    ]);

    const spawned = store.subagentsFor("parent-session")[0]!;
    expect(spawned.avatarId).toEqual(expect.any(String));
    const avatarId = spawned.avatarId;
    const viewSessionId = (spawned as typeof spawned & { viewSessionId?: string })
      .viewSessionId;
    expect(viewSessionId).toEqual(expect.any(String));
    expect(store.sideTabs()).toEqual([
      expect.objectContaining({
        type: "subagent",
        payload: viewSessionId,
        label: "Cicero",
        avatarId,
      }),
    ]);
    expect(store.sideActiveId()).toBe(viewSessionId);
    expect(store.get(viewSessionId!)).toMatchObject({
      kind: "side",
      sideKind: "subagent",
      subagentAvatarId: avatarId,
      label: "Cicero",
      status: "running",
      subagent: {
        parentSessionId: "parent-session",
        parentAcpSessionId: "parent-codex-thread",
        inheritance: "fresh",
      },
    });
    expect(store.turnsFor(viewSessionId!)).toEqual([
      expect.objectContaining({
        promptText: "Review the auth boundary",
        assistantText: "",
        status: "running",
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-wait",
        toolName: "wait_agent",
        status: "completed",
        rawInput: { targets: ["codex-child-thread"], timeout_ms: 60000 },
        rawOutput: {
          status: {
            "codex-child-thread": { completed: "CHILD_OK" },
          },
          timed_out: false,
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "codex-child-thread",
      avatarId,
      status: "complete",
      native: {
        provider: "codex",
        result: "CHILD_OK",
      },
    });
    expect(
      (store.subagentsFor("parent-session")[0] as SubagentActivity & {
        viewSessionId?: string;
      }).viewSessionId,
    ).toBe(viewSessionId);
    expect(store.sideTabs()).toHaveLength(1);
    expect(store.get(viewSessionId!)).toMatchObject({ status: "ready" });
    expect(store.turnsFor(viewSessionId!)).toEqual([
      expect.objectContaining({
        promptText: "Review the auth boundary",
        assistantText: "CHILD_OK",
        status: "complete",
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-close",
        toolName: "close_agent",
        status: "completed",
        rawInput: { target: "codex-child-thread" },
        rawOutput: {
          previous_status: { completed: "CHILD_OK" },
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "codex-child-thread",
      status: "complete",
      native: {
        provider: "codex",
        closed: true,
      },
    });
  });

  test("keeps split Codex spawn_agent output running until wait_agent completes", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-codex-thread",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "parent-session", "Spawn a native Codex subagent");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "call-spawn",
        toolName: "spawn_agent",
        status: "pending",
        rawInput: {
          agent_type: "default",
          fork_context: true,
          message: "Compare native session protocols",
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "codex:call-spawn",
      status: "running",
    });
    expect(store.subagentsFor("parent-session")).toHaveLength(1);
    const initialActivity = store.subagentsFor("parent-session")[0]!;
    expect(initialActivity.avatarId).toEqual(expect.any(String));
    const initialAvatarId = initialActivity.avatarId;
    const initialViewSessionId = (
      initialActivity as typeof initialActivity & { viewSessionId?: string }
    ).viewSessionId;
    expect(initialViewSessionId).toEqual(expect.any(String));
    expect(store.sideTabs()).toEqual([
      expect.objectContaining({
        type: "subagent",
        payload: initialViewSessionId,
        label: "Compare native session…",
        avatarId: initialAvatarId,
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-spawn",
        status: "completed",
        rawOutput: {
          agent_id: "codex-child-thread",
          nickname: "Cicero",
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "codex-child-thread",
      avatarId: initialAvatarId,
      inheritance: "fork",
      task: "Compare native session protocols",
      status: "running",
      native: {
        provider: "codex",
        childThreadId: "codex-child-thread",
        nickname: "Cicero",
      },
    });
    expect(store.subagentsFor("parent-session")).toHaveLength(1);
    expect(store.sideTabs()).toHaveLength(1);
    expect(
      (store.subagentsFor("parent-session")[0] as SubagentActivity & {
        viewSessionId?: string;
      }).viewSessionId,
    ).toBe(initialViewSessionId);
    expect(store.sideTabs()[0]).toMatchObject({
      payload: initialViewSessionId,
      label: "Cicero",
      avatarId: initialAvatarId,
    });
  });

  test("tracks explicit Codex spawnAgent tool invocations for generic agent ids", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-thread",
      agent_id: "agent",
      cwd: "/repo",
    });
    store.setActive("parent-session");
    store.registerTurn("turn-parent", "parent-session", "Ask a native Codex agent");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "call-spawn",
        title: "spawnAgent",
        status: "completed",
        rawInput: {
          forkContext: true,
          message: "Explore the architecture",
        },
        rawOutput: {
          agent_id: "codex-child-thread",
          nickname: "Jason",
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "codex-child-thread",
      inheritance: "fork",
      task: "Explore the architecture",
      status: "running",
      native: {
        provider: "codex",
        childThreadId: "codex-child-thread",
        nickname: "Jason",
      },
    });
    expect(store.sideTabs()).toEqual([
      expect.objectContaining({
        type: "subagent",
        label: "Jason",
      }),
    ]);
  });

  test("tracks Claude Code Task tool invocations as native subagent activity", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-claude-thread",
      agent_id: "claude-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "parent-session", "Ask a native Claude agent");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        type: "agent.tool_use",
        id: "toolu-task",
        name: "Task",
        input: {
          subagent_type: "general-purpose",
          description: "Audit native subagent protocol",
          prompt: "Inspect Codex and Claude native subagent events.",
        },
      },
    });

    expect(store.subagentsFor("parent-session")).toEqual([
      expect.objectContaining({
        childSessionId: "claude:toolu-task",
        parentSessionId: "parent-session",
        parentAcpSessionId: "parent-claude-thread",
        inheritance: "fresh",
        task: "Audit native subagent protocol",
        status: "running",
        native: expect.objectContaining({
          provider: "claude",
          toolCallId: "toolu-task",
          agentType: "general-purpose",
        }),
      }),
    ]);
    expect(store.subagentsFor("parent-session")[0]?.native?.childThreadId).toBeUndefined();

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "toolu-child-read",
        rawInput: { file_path: "/repo/src/main.ts" },
        _meta: {
          claudeCode: {
            toolName: "Read",
            parentToolUseId: "toolu-task",
          },
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]?.native).toMatchObject({
      provider: "claude",
      toolCallId: "toolu-task",
      childToolCallIds: ["toolu-child-read"],
    });

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu-task",
        status: "completed",
        rawOutput: [
          {
            type: "text",
            text: "Async agent launched successfully.\nagentId: text-only",
          },
        ],
        _meta: {
          claudeCode: {
            toolName: "Agent",
            toolResponse: {
              isAsync: true,
              status: "async_launched",
              agentId: "claude-child-agent",
              description: "Audit native subagent protocol",
              prompt: "Inspect Codex and Claude native subagent events.",
            },
          },
        },
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "claude-child-agent",
      status: "running",
      native: {
        provider: "claude",
        childThreadId: "claude-child-agent",
      },
    });

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        type: "agent.tool_result",
        tool_use_id: "toolu-task",
        content: [
          {
            type: "text",
            text: "Findings ready.\nagentId: claude-child-agent (use SendMessage with to: 'claude-child-agent' to continue this agent)",
          },
        ],
      },
    });

    expect(store.subagentsFor("parent-session")[0]).toMatchObject({
      childSessionId: "claude-child-agent",
      status: "complete",
      native: {
        provider: "claude",
        result: expect.stringContaining("Findings ready."),
      },
    });
  });

  test("does not infer native subagents from non-native tool names", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "parent-session",
      acp_session_id: "parent-generic-thread",
      agent_id: "gemini-acp",
      cwd: "/repo",
    });
    store.registerTurn("turn-parent", "parent-session", "Run a generic tool");

    store.apply({
      type: "session.event",
      session_id: "parent-session",
      turn_id: "turn-parent",
      event: {
        type: "agent.tool_use",
        id: "toolu-task",
        name: "Task",
        input: {
          description: "This is just a tool name in another adapter",
          prompt: "Do not treat this as Claude Code native subagent protocol.",
        },
      },
    });

    expect(store.subagentsFor("parent-session")).toEqual([]);
  });
});

describe("SessionStore pair chat grouping", () => {
  test("creates one normal turn per pair member for a shared prompt", () => {
    const store = new SessionStore();
    const pairId = store.newDraftPair([
      "pair-test-codex",
      "pair-test-claude",
    ]);
    const pair = store.pair(pairId);

    expect(pair?.members).toHaveLength(2);

    const targets = store.registerPairTurn(pairId, "Compare approaches");

    expect(targets).toHaveLength(2);
    expect(new Set(targets?.map((target) => target.turn_id)).size).toBe(2);

    for (const target of targets ?? []) {
      expect(store.turnsFor(target.session_id)).toMatchObject([
        {
          id: target.turn_id,
          promptText: "Compare approaches",
          status: "running",
        },
      ]);
    }

    expect(store.pair(pairId)?.activeTurnId).toBeTruthy();

    store.apply({
      type: "session.complete",
      session_id: targets?.[0]?.session_id ?? "",
      turn_id: targets?.[0]?.turn_id ?? "",
    });

    expect(store.pair(pairId)?.activeTurnId).toBeTruthy();

    store.apply({
      type: "session.complete",
      session_id: targets?.[1]?.session_id ?? "",
      turn_id: targets?.[1]?.turn_id ?? "",
    });

    expect(store.pair(pairId)?.activeTurnId).toBeUndefined();
  });

  test("persists pair grouping metadata through the app API", () => {
    const store = new SessionStore();
    const pairSave = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      backchat: { pairSave },
    });

    const pairId = store.newDraftPair([
      "pair-persist-codex",
      "pair-persist-claude",
    ]);

    expect(pairSave).toHaveBeenCalledWith(
      expect.objectContaining({
        pair_id: pairId,
        members: store.pair(pairId)?.members.map((session_id) =>
          expect.objectContaining({ session_id }),
        ),
      }),
    );
  });
});
