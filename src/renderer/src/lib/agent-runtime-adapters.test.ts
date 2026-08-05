import { describe, expect, test } from "vitest";
import {
  claudeCodeRuntimeAdapter,
  codexRuntimeAdapter,
  genericAcpRuntimeAdapter,
  kimiRuntimeAdapter,
  kiloRuntimeAdapter,
  openCodeRuntimeAdapter,
  piRuntimeAdapter,
  resolveAgentRuntimeAdapter,
} from "./agent-runtime-adapters";
import { CLAUDE_AGENT_ACP_0_64_2_FIXTURE } from "./fixtures/harness-events/claude-agent-acp-0.64.2";
import { KIMI_1_49_0_FIXTURE } from "./fixtures/harness-events/kimi-1.49.0";

describe("agent runtime adapters", () => {
  test("resolves each supported agent through its own runtime adapter", () => {
    expect(resolveAgentRuntimeAdapter("codex-acp")).toBe(codexRuntimeAdapter);
    expect(resolveAgentRuntimeAdapter("claude-acp")).toBe(claudeCodeRuntimeAdapter);
    expect(resolveAgentRuntimeAdapter("cc")).toBe(claudeCodeRuntimeAdapter);
    expect(resolveAgentRuntimeAdapter("opencode")?.provider).toBe("opencode");
    expect(resolveAgentRuntimeAdapter("kilo")?.provider).toBe("kilo");
    expect(resolveAgentRuntimeAdapter("pi-acp")).toBe(piRuntimeAdapter);
    expect(resolveAgentRuntimeAdapter("cursor")?.provider).toBe("cursor");
    expect(resolveAgentRuntimeAdapter("kimi-acp")).toBe(kimiRuntimeAdapter);
    expect(resolveAgentRuntimeAdapter("custom-acp")).toBeUndefined();
  });

  test("normalizes Kimi's confirmed background-task completion notification", () => {
    expect(kimiRuntimeAdapter.assistantBackgroundWorkItemUpdates?.(
      KIMI_1_49_0_FIXTURE.events.backgroundCompleted.content.text,
    )).toEqual([{
      id: "b1234567",
      kind: "other",
      status: "completed",
      title: "build project",
      canStop: false,
      result: {
        description: "build project",
        notification: "Background task completed: build project",
        status: "completed",
      },
    }]);
  });

  test.each([
    [
      "failed",
      "failed",
      "failed",
      "worker exited 1",
    ],
    [
      "stopped",
      "killed",
      "killed",
      "stopped by user",
    ],
    [
      "lost",
      "lost",
      "failed",
      "worker heartbeat expired",
    ],
  ] as const)(
    "maps Kimi background-task %s notification without inventing another terminal state",
    (titleStatus, reportedStatus, canonicalStatus, failureReason) => {
      expect(kimiRuntimeAdapter.assistantBackgroundWorkItemUpdates?.(
        `[Notification] Background task ${titleStatus}: audit\n`
          + "Task ID: b7654321\n"
          + `Status: ${reportedStatus}\n`
          + "Description: audit\n"
          + `Failure reason: ${failureReason}`,
      )).toEqual([
        expect.objectContaining({
          id: "b7654321",
          kind: "other",
          status: canonicalStatus,
          title: "audit",
          canStop: false,
          error: failureReason,
          ...(reportedStatus === "lost" ? { reason: "lost" } : {}),
        }),
      ]);
    },
  );

  test("ignores ordinary Kimi assistant text and unsupported task statuses", () => {
    expect(kimiRuntimeAdapter.assistantBackgroundWorkItemUpdates?.(
      "The build is complete.",
    )).toEqual([]);
    expect(kimiRuntimeAdapter.assistantBackgroundWorkItemUpdates?.(
      "[Notification] Background task updated: build project\n"
        + "Task ID: b1234567\n"
        + "Status: running",
    )).toEqual([]);
  });

  test("keeps native subagent parsing inside the matching provider adapter", () => {
    const codexSpawn = {
      toolCallId: "codex-spawn",
      toolName: "spawn_agent",
      status: "completed" as const,
      rawInput: { message: "Inspect the project" },
      rawOutput: { agent_id: "codex-child" },
    };
    const claudeSpawn = {
      toolCallId: "cc-task",
      toolName: "Task",
      status: "completed" as const,
      rawInput: { description: "Inspect the project" },
    };

    expect(codexRuntimeAdapter.nativeAgentToolUpdates(codexSpawn)).toHaveLength(1);
    expect(codexRuntimeAdapter.nativeAgentToolUpdates(claudeSpawn)).toEqual([]);
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates(claudeSpawn)).toHaveLength(1);
    expect(claudeCodeRuntimeAdapter.nativeAgentToolUpdates(codexSpawn)).toEqual([]);
  });

  test("maps the confirmed Codex Goal payload inside the Codex adapter", () => {
    expect(
      codexRuntimeAdapter.sessionGoalUpdate({
        update: { sessionUpdate: "session_info_update" },
        meta: {
          codex: {
            goal: {
              objective: "Keep Goal adapter-owned",
              status: "active",
              tokenBudget: 40_000,
            },
          },
        },
      }),
    ).toEqual({
      objective: "Keep Goal adapter-owned",
      status: "active",
      tokenBudget: 40_000,
    });
  });

  test("maps Codex thread status inside the Codex adapter", () => {
    expect(codexRuntimeAdapter.sessionThreadStatusUpdate({
      update: { sessionUpdate: "session_info_update" },
      meta: { codex: { threadStatus: { type: "active" } } },
    })).toBe("active");
  });

  test.each([
    ["Claude Code", claudeCodeRuntimeAdapter],
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
    ["Pi", piRuntimeAdapter],
    ["generic ACP", genericAcpRuntimeAdapter],
  ])("%s does not infer Goal semantics from another harness payload", (_name, adapter) => {
    expect(
      adapter.sessionGoalUpdate({
        update: { sessionUpdate: "session_info_update" },
        meta: {
          codex: {
            goal: {
              objective: "Do not steal this payload",
              status: "active",
            },
          },
        },
      }),
    ).toBeUndefined();
    expect(adapter.sessionThreadStatusUpdate({
      update: { sessionUpdate: "session_info_update" },
      meta: { codex: { threadStatus: { type: "active" } } },
    })).toBeUndefined();
  });

  test("maps Claude Code Task tools to normalized background task updates", () => {
    const updates = claudeCodeRuntimeAdapter.nativeAgentToolUpdates({
      toolCallId: "cc-task",
      toolName: "Task",
      status: "completed",
      rawInput: {
        subagent_type: "general-purpose",
        description: "Audit the resource panel",
      },
      meta: {
        claudeCode: {
          toolResponse: {
            isAsync: true,
            status: "async_launched",
            agentId: "cc-child-1",
          },
        },
      },
    });

    expect(updates).toEqual([
      expect.objectContaining({
        provider: "claude",
        childId: "cc-child-1",
        task: "Audit the resource panel",
        status: "running",
      }),
    ]);
  });

  test("normalizes Claude background Bash and TaskStop work-item evidence", () => {
    const adapter = claudeCodeRuntimeAdapter as typeof claudeCodeRuntimeAdapter & {
      backgroundWorkItemToolUpdates: (tool: Record<string, unknown>) => Array<Record<string, unknown>>;
    };

    expect(adapter.backgroundWorkItemToolUpdates({
      toolCallId: "bash-call-1",
      toolName: "Bash",
      status: "pending",
      rawInput: {
        command: "pnpm test --watch",
        run_in_background: true,
      },
    })).toEqual([
      expect.objectContaining({
        id: "claude-bash:bash-call-1",
        toolCallId: "bash-call-1",
        kind: "bash",
        title: "pnpm test --watch",
        command: "pnpm test --watch",
        status: "running",
        canStop: false,
      }),
    ]);

    expect(adapter.backgroundWorkItemToolUpdates({
      toolCallId: "bash-call-1",
      toolName: "Bash",
      status: "completed",
      rawInput: {
        command: "pnpm test --watch",
        run_in_background: true,
      },
      meta: {
        claudeCode: {
          toolName: "Bash",
          toolResponse: {
            backgroundTaskId: "bash-task-1",
            stdout: "",
            stderr: "",
            interrupted: false,
          },
        },
      },
    })).toEqual([
      expect.objectContaining({
        id: "bash-task-1",
        previousId: "claude-bash:bash-call-1",
        kind: "bash",
        status: "running",
      }),
    ]);

    expect(adapter.backgroundWorkItemToolUpdates({
      toolCallId: "stop-call-1",
      toolName: "TaskStop",
      status: "completed",
      meta: {
        claudeCode: {
          toolName: "TaskStop",
          toolResponse: { task_id: "bash-task-1", message: "Stopped" },
        },
      },
    })).toEqual([
      expect.objectContaining({
        id: "bash-task-1",
        kind: "other",
        status: "killed",
        reason: "task_stop",
      }),
    ]);
  });

  test("distinguishes a Monitor launch from a TaskOutput observation", () => {
    const adapter = claudeCodeRuntimeAdapter as typeof claudeCodeRuntimeAdapter & {
      backgroundWorkItemToolUpdates: (tool: Record<string, unknown>) => Array<Record<string, unknown>>;
    };

    expect(adapter.backgroundWorkItemToolUpdates({
      toolCallId: "output-call-1",
      toolName: "TaskOutput",
      status: "completed",
      rawInput: { task_id: "monitor-task-1", block: true, timeout: 30_000 },
      rawOutput: "Monitor is still running",
    })).toEqual([]);

    expect(adapter.backgroundWorkItemToolUpdates({
      toolCallId: "monitor-call-1",
      toolName: "Monitor",
      status: "completed",
      rawInput: {
        description: "Watch CI until it settles",
        command: "gh run watch",
        timeout_ms: 300_000,
        persistent: false,
      },
      meta: {
        claudeCode: {
          toolName: "Monitor",
          toolResponse: {
            taskId: "monitor-task-1",
            timeoutMs: 300_000,
            persistent: false,
          },
        },
      },
    })).toEqual([{
      id: "monitor-task-1",
      toolCallId: "monitor-call-1",
      kind: "monitor",
      status: "running",
      title: "Watch CI until it settles",
      command: "gh run watch",
      canStop: false,
    }]);
  });

  test("maps Claude raw SDK monitor lifecycle without inferring a missing terminal state", () => {
    const adapter = claudeCodeRuntimeAdapter as typeof claudeCodeRuntimeAdapter & {
      backgroundWorkItemRawUpdates: (event: unknown) => Array<Record<string, unknown>>;
    };

    expect(adapter.backgroundWorkItemRawUpdates({
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-session-1",
        message: {
          type: "system",
          subtype: "task_started",
          task_id: "monitor-task-1",
          task_type: "monitor",
          description: "errors in deploy.log",
        },
      },
    })).toEqual([{
      id: "monitor-task-1",
      kind: "monitor",
      status: "running",
      title: "errors in deploy.log",
      canStop: false,
    }]);

    expect(adapter.backgroundWorkItemRawUpdates({
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-session-1",
        message: {
          type: "system",
          subtype: "task_notification",
          task_id: "monitor-task-1",
          status: "completed",
          output_file: "/tmp/monitor-task-1.output",
          summary: "Monitor exited with code 0",
        },
      },
    })).toEqual([{
      id: "monitor-task-1",
      kind: "other",
      status: "completed",
      result: {
        output_file: "/tmp/monitor-task-1.output",
        summary: "Monitor exited with code 0",
      },
    }]);

    expect(adapter.backgroundWorkItemRawUpdates({
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        message: {
          type: "user",
          origin: { kind: "task-notification" },
          message: {
            role: "user",
            content: "Monitor event: \"errors in deploy.log\"\n<event>ERROR timeout</event>",
          },
        },
      },
    })).toEqual([]);
  });

  test("keeps Claude local_bash task starts generic without tool identity evidence", () => {
    expect(claudeCodeRuntimeAdapter.backgroundWorkItemRawUpdates?.({
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "acp-session-1",
        message: {
          type: "system",
          subtype: "task_started",
          task_id: "local-task-1",
          tool_use_id: "toolu-local-task",
          task_type: "local_bash",
          description: "Watch CI status",
          uuid: "00000000-0000-4000-8000-000000000051",
          session_id: "sdk-session-1",
        },
      },
    })).toEqual([{
      id: "local-task-1",
      toolCallId: "toolu-local-task",
      kind: "other",
      status: "running",
      title: "Watch CI status",
      canStop: false,
    }]);
  });

  test("maps Claude monitor_ws task starts to Monitor", () => {
    expect(claudeCodeRuntimeAdapter.backgroundWorkItemRawUpdates?.({
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        message: {
          type: "system",
          subtype: "task_started",
          task_id: "monitor-ws-1",
          task_type: "monitor_ws",
          description: "Watch deployment WebSocket",
          uuid: "00000000-0000-4000-8000-000000000052",
          session_id: "sdk-session-1",
        },
      },
    })).toEqual([{
      id: "monitor-ws-1",
      kind: "monitor",
      status: "running",
      title: "Watch deployment WebSocket",
      canStop: false,
    }]);
  });

  test("maps Claude monitor_ws background levels to Monitor", () => {
    expect(claudeCodeRuntimeAdapter.backgroundWorkItemLevel?.({
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        message: {
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [{
            task_id: "monitor-ws-1",
            task_type: "monitor_ws",
            description: "Watch deployment WebSocket",
          }],
          uuid: "00000000-0000-4000-8000-000000000053",
          session_id: "sdk-session-1",
        },
      },
    })).toEqual({
      eventId: "00000000-0000-4000-8000-000000000053",
      liveTaskIds: ["monitor-ws-1"],
      liveWorkItems: [{
        id: "monitor-ws-1",
        kind: "monitor",
        status: "running",
        title: "Watch deployment WebSocket",
        canStop: false,
      }],
    });
  });

  test("maps Claude SDK subagent task_progress without inventing token splits", () => {
    expect(claudeCodeRuntimeAdapter.nativeAgentRawUpdates(
      CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.subagentTaskProgress,
    )).toEqual([{
      provider: "claude",
      operation: "claude_agent",
      toolCallId: "toolu-agent-parent",
      childId: "agent-task-42",
      task: "Audit renderer event handling",
      agentType: "Explore",
      progress: {
        kind: "subagent_progress",
        description: "Audit renderer event handling",
        subagentType: "Explore",
        lastToolName: "Grep",
        summary: "Located the adapter boundary",
        usage: {
          totalTokens: 1234,
          toolUses: 7,
          durationMs: 8400,
        },
      },
    }]);
  });

  test("maps Claude SDK subagent task_started with its stable identity", () => {
    expect(claudeCodeRuntimeAdapter.nativeAgentRawUpdates(
      CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.subagentTaskStarted,
    )).toEqual([{
      provider: "claude",
      operation: "claude_agent",
      toolCallId: "toolu-agent-parent",
      childId: "agent-task-42",
      task: "Audit renderer event handling",
      agentType: "Explore",
      status: "running",
    }]);
  });

  test("maps non-agent Claude SDK task_progress as work-item progress", () => {
    expect(claudeCodeRuntimeAdapter.backgroundWorkItemRawUpdates?.(
      CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.backgroundTaskProgress,
    )).toEqual([{
      id: "background-task-7",
      toolCallId: "toolu-background-parent",
      kind: "other",
      phase: "progress",
      status: "running",
      title: "Build release artifacts",
      progress: {
        description: "Build release artifacts",
        lastToolName: "Bash",
        summary: "Bundling renderer",
        usage: {
          totalTokens: 0,
          toolUses: 3,
          durationMs: 5100,
        },
      },
    }]);
  });

  test("extracts the stable task id from a Claude Monitor notification", () => {
    const adapter = claudeCodeRuntimeAdapter as typeof claudeCodeRuntimeAdapter & {
      monitorRawEvents: (event: unknown) => Array<Record<string, unknown>>;
    };

    expect(adapter.monitorRawEvents({
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        message: {
          type: "user",
          origin: { kind: "task-notification" },
          message: {
            role: "user",
            content:
              "<task-notification>\n"
              + "<task-id>monitor-task-1</task-id>\n"
              + "<summary>Monitor event: \"errors in deploy.log\"</summary>\n"
              + "<event>ERROR timeout</event>\n"
              + "If this event is actionable, tell the user.\n"
              + "</task-notification>",
          },
        },
      },
    })).toEqual([{
      description: "errors in deploy.log",
      text: "ERROR timeout",
      monitorId: "monitor-task-1",
    }]);
  });

  test("decodes XML-escaped Claude Monitor notification fields", () => {
    expect(claudeCodeRuntimeAdapter.monitorRawEvents?.({
      type: "acp.extension_notification",
      method: "_claude/sdkMessage",
      params: {
        message: {
          type: "user",
          origin: { kind: "task-notification" },
          message: {
            role: "user",
            content:
              "<task-notification>\n"
              + "<task-id>monitor-task-&amp;1</task-id>\n"
              + "<summary>Monitor event: \"CI &amp; deploy\"</summary>\n"
              + "<event>ERROR &lt;timeout&gt; &amp; retry</event>\n"
              + "</task-notification>",
          },
        },
      },
    })).toEqual([{
      description: "CI & deploy",
      text: "ERROR <timeout> & retry",
      monitorId: "monitor-task-&1",
    }]);
  });

  test("normalizes Claude nested transcript chunks from adapter metadata", () => {
    expect(claudeCodeRuntimeAdapter.nativeAgentTranscriptUpdates({
      sessionUpdate: "agent_message_chunk",
      _meta: { claudeCode: { parentToolUseId: "task-parent" } },
      content: { type: "text", text: "child output" },
    })).toEqual([
      expect.objectContaining({
        provider: "claude",
        parentToolUseId: "task-parent",
        kind: "text",
        text: "child output",
      }),
    ]);
  });

  test("keeps Claude nested non-text content correlated with the child", () => {
    const content = {
      type: "resource_link",
      uri: "file:///work/child-report.pdf",
      name: "child-report.pdf",
    };

    expect(claudeCodeRuntimeAdapter.nativeAgentTranscriptUpdates({
      sessionUpdate: "agent_message_chunk",
      _meta: { claudeCode: { parentToolUseId: "task-parent" } },
      content,
    })).toEqual([
      expect.objectContaining({
        provider: "claude",
        parentToolUseId: "task-parent",
        kind: "content",
        content,
      }),
    ]);
  });

  test("requires explicit Codex output citations instead of treating file edits as outputs", () => {
    expect(
      codexRuntimeAdapter.workspaceArtifacts({
        toolCallId: "codex-write",
        title: "Write file",
        status: "completed",
        rawInput: { path: "/work/report.html" },
      }).outputs.files,
    ).toEqual([]);

    expect(
      codexRuntimeAdapter.assistantArtifacts?.(
        'Done. :codex-file-citation{path="/work/report.html" purpose="output"}',
      ),
    ).toEqual({
      outputs: { files: ["/work/report.html"], services: [] },
      sources: [],
    });

    expect(
      codexRuntimeAdapter.assistantArtifacts?.(
        ':codex-file-citation{path="/work/reference.pdf" purpose="source"}',
      ),
    ).toEqual({
      outputs: { files: [], services: [] },
      sources: [{ kind: "file", uri: "/work/reference.pdf" }],
    });
  });

  test("keeps Claude Code deliverable writes but does not promote reads to Sources", () => {

    expect(
      claudeCodeRuntimeAdapter.workspaceArtifacts({
        toolCallId: "cc-read",
        toolName: "Read",
        status: "completed",
        rawInput: { file_path: "/work/reference.pptx" },
      }).sources,
    ).toEqual([]);

    expect(
      claudeCodeRuntimeAdapter.workspaceArtifacts({
        toolCallId: "cc-write",
        toolName: "Write",
        status: "completed",
        rawInput: { file_path: "/work/result.pptx" },
      }).outputs.files,
    ).toEqual(["/work/result.pptx"]);
  });

  test("does not classify source-code writes or diffs as Outputs", () => {
    expect(
      claudeCodeRuntimeAdapter.workspaceArtifacts({
        toolCallId: "cc-code-write",
        toolName: "Write",
        status: "completed",
        rawInput: { file_path: "/work/src/panel.tsx" },
      }).outputs.files,
    ).toEqual([]);

    expect(
      codexRuntimeAdapter.workspaceArtifacts({
        toolCallId: "codex-diff",
        title: "Apply patch",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/work/src/panel.tsx",
            newText: "export function Panel() {}",
          },
        ],
      }).outputs.files,
    ).toEqual([]);
  });

  test("maps Claude Code web fetches to source URLs", () => {
    expect(
      claudeCodeRuntimeAdapter.workspaceArtifacts({
        toolCallId: "cc-fetch",
        toolName: "WebFetch",
        status: "completed",
        rawInput: { url: "https://example.com/reference" },
        rawOutput: "The fetched page links to https://example.com/unrelated",
      }).sources,
    ).toEqual([
      { kind: "web", uri: "https://example.com/reference" },
    ]);
  });

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])("%s maps only explicit WebFetch URLs to Sources", (_name, adapter) => {
    expect(
      adapter.workspaceArtifacts({
        toolCallId: "fetch-reference",
        title: "https://example.com/reference (text/html)",
        kind: "fetch",
        status: "completed",
        rawInput: {
          url: "https://example.com/reference",
          format: "markdown",
        },
        rawOutput: {
          output: "Contains https://example.com/unrelated",
          metadata: {},
        },
      }).sources,
    ).toEqual([
      { kind: "web", uri: "https://example.com/reference" },
    ]);

    expect(
      adapter.workspaceArtifacts({
        toolCallId: "search-reference",
        toolName: "websearch",
        kind: "other",
        status: "completed",
        rawInput: { query: "reference" },
      }).sources,
    ).toEqual([]);

    expect(
      adapter.workspaceArtifacts({
        toolCallId: "non-native-fetch-shape",
        title: "https://example.com/reference",
        kind: "fetch",
        status: "completed",
        rawInput: { uri: "https://example.com/reference" },
      }).sources,
    ).toEqual([]);
  });

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])("%s maps deliverable writes but excludes source code", (_name, adapter) => {
    expect(
      adapter.workspaceArtifacts({
        toolCallId: "write-deck",
        title: "Wrote review.pptx",
        kind: "edit",
        status: "completed",
        rawInput: { filePath: "/work/review.pptx" },
      }).outputs.files,
    ).toEqual(["/work/review.pptx"]);

    expect(
      adapter.workspaceArtifacts({
        toolCallId: "write-code",
        title: "Wrote panel.tsx",
        kind: "edit",
        status: "completed",
        rawInput: { filePath: "/work/src/panel.tsx" },
      }).outputs.files,
    ).toEqual([]);

    expect(
      adapter.workspaceArtifacts({
        toolCallId: "non-native-edit-shape",
        title: "Wrote review.pptx",
        kind: "edit",
        status: "completed",
        rawInput: { path: "/work/review.pptx" },
      }).outputs.files,
    ).toEqual([]);
  });

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])("%s normalizes its structured todowrite snapshot at the adapter boundary", (_name, adapter) => {
    const planToolUpdates = (
      adapter as typeof adapter & {
        planToolUpdates?: (tool: Record<string, unknown>) => unknown[];
      }
    ).planToolUpdates;
    expect(planToolUpdates?.({
      toolCallId: "todos-1",
      toolName: "todowrite",
      status: "pending",
      rawInput: {
        todos: [
          {
            id: "todo-a",
            content: "Inspect adapter",
            status: "completed",
            priority: "high",
          },
          {
            id: "todo-b",
            content: "Persist canonical plan",
            status: "in_progress",
            priority: "medium",
          },
        ],
      },
    })).toEqual([{
      planId: "todos-1",
      updateMode: "replace",
      entries: [
        {
          id: "todo-a",
          content: "Inspect adapter",
          status: "completed",
          priority: "high",
        },
        {
          id: "todo-b",
          content: "Persist canonical plan",
          status: "in_progress",
          priority: "medium",
        },
      ],
    }]);
    expect(planToolUpdates?.({
      toolCallId: "todos-lookalike",
      toolName: "think",
      status: "pending",
      rawInput: { todos: [{ content: "Do not project" }] },
    })).toEqual([]);
  });

  test.each([
    ["OpenCode", openCodeRuntimeAdapter, "opencode"],
    ["Kilo", kiloRuntimeAdapter, "kilo"],
  ])(
    "%s keeps an asynchronously launched Task running after its ACP tool completes",
    (_name, adapter, provider) => {
      expect(
        adapter.nativeAgentToolUpdates({
          toolCallId: "task-call-1",
          title: "Audit source handling",
          kind: "think",
          status: "completed",
          rawInput: {
            description: "Audit source handling",
            prompt: "Inspect the source pipeline",
            subagent_type: "explore",
            background: true,
          },
          rawOutput: {
            output:
              '<task id="child-session-1" state="running">\n<summary>Background task started</summary>\n<task_result>Working</task_result>\n</task>',
            metadata: {
              parentSessionId: "parent-session",
              sessionId: "child-session-1",
              background: true,
              jobId: "child-session-1",
            },
          },
        }),
      ).toEqual([
        {
          provider,
          operation: "subagent_spawn",
          toolCallId: "task-call-1",
          childId: "child-session-1",
          task: "Audit source handling",
          agentType: "explore",
          status: "running",
        },
      ]);
    },
  );

  test.each([
    ["OpenCode", openCodeRuntimeAdapter, "opencode"],
    ["Kilo", kiloRuntimeAdapter, "kilo"],
  ])(
    "%s consumes the exact synthetic Task terminal envelope emitted during ACP replay",
    (_name, adapter, provider) => {
      const terminal = {
        sessionUpdate: "user_message_chunk",
        content: {
          type: "text",
          text:
            '<task id="child-session-1" state="completed">'
            + '<summary>Background task completed: Audit source handling</summary>'
            + '<task_result>Done</task_result></task>',
          annotations: { audience: ["assistant"] },
        },
      };

      expect(adapter.nativeAgentRawUpdates(terminal)).toEqual([{
        provider,
        operation: "subagent_spawn",
        childId: "child-session-1",
        status: "complete",
        result: "Done",
      }]);
      expect(adapter.nativeAgentRawUpdates({
        ...terminal,
        content: { ...terminal.content, annotations: undefined },
      })).toEqual([]);
    },
  );

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])(
    "%s declares an unobservable post-turn Task terminal as missing",
    (_name, adapter) => {
      expect(adapter.settleNativeAgentOnParentTurnComplete).toBe("missing_terminal");
    },
  );

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])("%s requires native Task identity metadata", (_name, adapter) => {
    expect(
      adapter.nativeAgentToolUpdates({
        toolCallId: "task-looking-title",
        title: "Task",
        kind: "think",
        status: "completed",
        rawInput: {
          description: "Audit source handling",
          subagent_type: "explore",
        },
        rawOutput: { output: "Done" },
      }),
    ).toEqual([]);

    expect(
      adapter.nativeAgentToolUpdates({
        toolCallId: "task-name-without-native-identity",
        toolName: "Task",
        kind: "think",
        status: "completed",
        rawInput: {
          description: "Audit source handling",
          subagent_type: "explore",
        },
        rawOutput: { output: "Done" },
      }),
    ).toEqual([]);

  });

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])("%s treats omitted optional background as a foreground Task", (_name, adapter) => {
    const provider = adapter.provider;
    expect(
      adapter.nativeAgentToolUpdates({
        toolCallId: "foreground-task-default",
        kind: "think",
        status: "pending",
        rawInput: {
          description: "Audit source handling",
          prompt: "Inspect the source pipeline",
          subagent_type: "explore",
        },
      }),
    ).toEqual([{
      provider,
      operation: "subagent_spawn",
      toolCallId: "foreground-task-default",
      childId: `${provider}:foreground-task-default`,
      task: "Audit source handling",
      agentType: "explore",
      status: "running",
    }]);
  });

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])("%s uses task_id as the stable identity when resuming a Task", (_name, adapter) => {
    expect(
      adapter.nativeAgentToolUpdates({
        toolCallId: "resumed-task-call",
        kind: "think",
        status: "pending",
        rawInput: {
          description: "Continue source audit",
          prompt: "Continue from the previous findings",
          subagent_type: "explore",
          task_id: "existing-child-session",
        },
      }),
    ).toEqual([{
      provider: adapter.provider,
      operation: "subagent_spawn",
      toolCallId: "resumed-task-call",
      childId: "existing-child-session",
      task: "Continue source audit",
      agentType: "explore",
      status: "running",
    }]);
  });

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])("%s starts a foreground Task with a provisional native Agent id", (_name, adapter) => {
    const provider = adapter.provider;
    expect(
      adapter.nativeAgentToolUpdates({
        toolCallId: "foreground-task",
        kind: "think",
        status: "pending",
        rawInput: {
          description: "Inspect source handling",
          prompt: "Trace the source pipeline",
          subagent_type: "explore",
          background: false,
        },
      }),
    ).toEqual([{
      provider,
      operation: "subagent_spawn",
      toolCallId: "foreground-task",
      childId: `${provider}:foreground-task`,
      task: "Inspect source handling",
      agentType: "explore",
      status: "running",
    }]);
  });

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])("%s completes a foreground Task with its native child id and result", (_name, adapter) => {
    const provider = adapter.provider;
    expect(
      adapter.nativeAgentToolUpdates({
        toolCallId: "foreground-task",
        kind: "think",
        status: "completed",
        rawInput: {
          description: "Inspect source handling",
          prompt: "Trace the source pipeline",
          subagent_type: "explore",
          background: false,
        },
        rawOutput: {
          output:
            '<task id="child-session-2" state="completed"><task_result>Done</task_result></task>',
          metadata: {
            parentSessionId: "parent-session",
            sessionId: "child-session-2",
          },
        },
      }),
    ).toEqual([{
      provider,
      operation: "subagent_spawn",
      toolCallId: "foreground-task",
      childId: "child-session-2",
      task: "Inspect source handling",
      agentType: "explore",
      status: "complete",
      result: "Done",
    }]);
  });

  test.each([
    ["OpenCode", openCodeRuntimeAdapter],
    ["Kilo", kiloRuntimeAdapter],
  ])("%s fails a foreground Task without inventing a completion", (_name, adapter) => {
    const provider = adapter.provider;
    expect(
      adapter.nativeAgentToolUpdates({
        toolCallId: "foreground-task-error",
        kind: "think",
        status: "failed",
        rawInput: {
          description: "Inspect source handling",
          prompt: "Trace the source pipeline",
          subagent_type: "explore",
          background: false,
        },
        rawOutput: {
          output:
            '<task id="child-session-error" state="error">'
            + '<task_error>Child failed.</task_error></task>',
          metadata: {
            parentSessionId: "parent-session",
            sessionId: "child-session-error",
          },
        },
      }),
    ).toEqual([{
      provider,
      operation: "subagent_spawn",
      toolCallId: "foreground-task-error",
      childId: "child-session-error",
      task: "Inspect source handling",
      agentType: "explore",
      status: "error",
      errorMessage: "Child failed.",
    }]);
  });

  test("maps Cursor Task tool lifecycle to a provisional native Agent", () => {
    const adapter = resolveAgentRuntimeAdapter("cursor");

    expect(adapter?.nativeAgentToolUpdates({
      toolCallId: "cursor-task-1",
      title: "Explore the event pipeline",
      kind: "other",
      status: "pending",
      rawInput: {
        _toolName: "task",
        description: "Explore the event pipeline",
        prompt: "Inspect all event boundaries",
        subagentType: "explore",
      },
    })).toEqual([{
      provider: "cursor",
      operation: "subagent_spawn",
      toolCallId: "cursor-task-1",
      childId: "cursor:cursor-task-1",
      task: "Explore the event pipeline",
      agentType: "explore",
      status: "running",
    }]);

    expect(adapter?.nativeAgentToolUpdates({
      toolCallId: "cursor-task-1",
      status: "completed",
      rawOutput: { durationMs: 1250, isBackground: false },
    }, undefined, {
      toolCallId: "cursor-task-1",
      title: "Explore the event pipeline",
      kind: "other",
      status: "completed",
      rawInput: {
        _toolName: "task",
        description: "Explore the event pipeline",
        subagentType: "explore",
      },
      rawOutput: { durationMs: 1250, isBackground: false },
    })).toEqual([expect.objectContaining({
      provider: "cursor",
      childId: "cursor:cursor-task-1",
      status: "complete",
    })]);
  });

  test("uses Cursor Task raw output error as the native Agent terminal failure", () => {
    const adapter = resolveAgentRuntimeAdapter("cursor");

    expect(adapter?.nativeAgentToolUpdates({
      toolCallId: "cursor-task-failed",
      status: "completed",
    }, undefined, {
      toolCallId: "cursor-task-failed",
      status: "completed",
      rawInput: {
        _toolName: "task",
        description: "Inspect the failure",
        subagentType: "explore",
      },
      rawOutput: { error: "Subagent failed" },
    })).toEqual([expect.objectContaining({
      provider: "cursor",
      childId: "cursor:cursor-task-failed",
      status: "error",
      errorMessage: "Subagent failed",
    })]);
  });

  test("reidentifies a Cursor Task from its confirmed cursor/task extension request", () => {
    const adapter = resolveAgentRuntimeAdapter("cursor");

    expect(adapter?.nativeAgentRawUpdates({
      type: "acp.extension_request",
      method: "cursor/task",
      params: {
        toolCallId: "cursor-task-1",
        description: "Explore the event pipeline",
        subagentType: "explore",
        agentId: "cursor-child-7",
        durationMs: 1250,
      },
    })).toEqual([{
      provider: "cursor",
      operation: "subagent_spawn",
      toolCallId: "cursor-task-1",
      childId: "cursor-child-7",
      task: "Explore the event pipeline",
      agentType: "explore",
    }]);
  });

  test("maps Cursor's generate-image extension into existing Outputs and Sources", () => {
    const adapter = resolveAgentRuntimeAdapter("cursor") as
      | (ReturnType<typeof resolveAgentRuntimeAdapter> & {
          rawWorkspaceArtifacts?: (event: unknown) => {
            outputs: { files: string[]; services: string[] };
            sources: Array<{ kind: string; uri: string }>;
          };
        })
      | undefined;

    expect(adapter?.rawWorkspaceArtifacts?.({
      type: "acp.extension_request",
      method: "cursor/generate_image",
      params: {
        toolCallId: "image-call-1",
        description: "Architecture overview",
        filePath: "/work/architecture.png",
        referenceImagePaths: ["/work/reference.png"],
      },
    })).toEqual({
      outputs: { files: ["/work/architecture.png"], services: [] },
      sources: [{ kind: "file", uri: "/work/reference.png" }],
    });
  });

  test("maps only opened Codex web pages, not search queries, to Sources", () => {
    expect(
      codexRuntimeAdapter.workspaceArtifacts({
        toolCallId: "codex-open-page",
        title: "Open page: https://example.com/reference",
        kind: "search",
        status: "completed",
        rawInput: {
          query: "reference",
          action: {
            type: "openPage",
            url: "https://example.com/reference",
          },
        },
      }).sources,
    ).toEqual([
      { kind: "web", uri: "https://example.com/reference" },
    ]);

    expect(
      codexRuntimeAdapter.workspaceArtifacts({
        toolCallId: "codex-search",
        title: "Web search: reference",
        kind: "search",
        status: "completed",
        rawInput: {
          action: { type: "search", query: "reference" },
        },
      }).sources,
    ).toEqual([]);
  });

  test("keeps generated Codex media as an output", () => {
    expect(
      codexRuntimeAdapter.workspaceArtifacts({
        toolCallId: "codex-image",
        title: "Image generation",
        status: "completed",
        rawOutput: {
          status: "completed",
          savedPath: "/work/generated/chart.png",
        },
      }).outputs.files,
    ).toEqual(["/work/generated/chart.png"]);
  });

  test("maps Pi's structured write and edit inputs to deliverable Outputs", () => {
    expect(
      piRuntimeAdapter.workspaceArtifacts({
        toolCallId: "pi-write",
        title: "write",
        kind: "edit",
        status: "completed",
        rawInput: { path: "/work/review.pptx", content: "deck" },
      }).outputs.files,
    ).toEqual(["/work/review.pptx"]);

    expect(
      piRuntimeAdapter.workspaceArtifacts({
        toolCallId: "pi-edit",
        title: "edit",
        kind: "edit",
        status: "completed",
        rawInput: { file_path: "/work/report.pdf" },
      }).outputs.files,
    ).toEqual(["/work/report.pdf"]);
  });

  test("does not invent Pi Sources, Agents, or Outputs from reads and code edits", () => {
    expect(
      piRuntimeAdapter.workspaceArtifacts({
        toolCallId: "pi-read",
        title: "read",
        kind: "read",
        status: "completed",
        rawInput: { path: "/work/reference.pdf" },
      }),
    ).toEqual({
      outputs: { files: [], services: [] },
      sources: [],
    });

    expect(
      piRuntimeAdapter.workspaceArtifacts({
        toolCallId: "pi-code-edit",
        title: "write",
        kind: "edit",
        status: "completed",
        rawInput: { path: "/work/src/panel.tsx" },
      }).outputs.files,
    ).toEqual([]);

    expect(
      piRuntimeAdapter.nativeAgentToolUpdates({
        toolCallId: "task-looking-tool",
        title: "Task",
        status: "completed",
        rawInput: { description: "inspect sources" },
      }),
    ).toEqual([]);
  });

  test("does not reinterpret generic ACP locations as outputs", () => {
    expect(
      genericAcpRuntimeAdapter.workspaceArtifacts({
        toolCallId: "custom-output",
        title: "Generate report",
        status: "completed",
        locations: [{ path: "/work/result.pdf" }],
        rawOutput: "Preview at http://localhost:4173/report",
      }),
    ).toEqual({
      outputs: {
        files: [],
        services: [],
      },
      sources: [],
    });
  });
});
