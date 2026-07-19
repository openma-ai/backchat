import { describe, expect, it, vi } from "vitest";
import type { AcpSession, SessionOptions } from "@open-managed-agents-desktop/acp";
import { acpEventUiRoute, SessionManager } from "./session-manager";
import { appendEvent, appendEventsTx, setSessionTitle } from "./sql-store.js";

const mocks = vi.hoisted(() => ({
  runtimeStart: vi.fn(),
  probeAgentAuthStatus: vi.fn(async () => ({ status: "configured" })),
  installAcpRegistryAgent: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    once(event: string, cb: (code?: number) => void) {
      if (event === "exit") queueMicrotask(() => cb(0));
      return this;
    },
  })),
}));

vi.mock("@open-managed-agents-desktop/acp", () => ({
  AcpRuntimeImpl: vi.fn().mockImplementation(function AcpRuntimeImpl() {
    return {
      start: mocks.runtimeStart,
    };
  }),
}));

vi.mock("@open-managed-agents-desktop/acp/node-spawner", () => ({
  NodeSpawner: vi.fn(),
}));

vi.mock("@open-managed-agents-desktop/acp/registry", () => ({
  resolveKnownAgent: vi.fn((id: string) => ({
    id,
    label: id,
    spec: { command: id === "registry-agent" ? "registry-agent" : "node", args: [] },
    ...(id === "registry-agent"
      ? { registryId: "registry-agent", installSource: "registry" as const }
      : {}),
  })),
}));

vi.mock("@open-managed-agents-desktop/acp/binary-update", () => ({
  ensureLatestAcpBinary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@open-managed-agents-desktop/acp/installer", () => ({
  installAcpRegistryAgent: mocks.installAcpRegistryAgent,
}));

vi.mock("@open-managed-agents-desktop/acp/probe", () => ({
  probeAgentAuthStatus: mocks.probeAgentAuthStatus,
}));

vi.mock("./sql-store.js", () => ({
  appendEvent: vi.fn(),
  appendEventsTx: vi.fn(),
  archiveSession: vi.fn(),
  setSessionTitle: vi.fn(),
  setSessionTitleIfEmpty: vi.fn(),
  touchSession: vi.fn(),
  upsertSession: vi.fn(),
}));

vi.mock("./session-cwd.js", () => ({
  ensureSessionCwd: vi.fn().mockResolvedValue("/tmp/backchat-test"),
  removeSessionCwd: vi.fn(),
}));

describe("SessionManager prompt queue", () => {
  it("cancels session-scoped broker work when an active turn is cancelled", async () => {
    mocks.runtimeStart.mockClear();
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: vi.fn(),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({}),
      resolveAgentOverride: () => undefined,
    });
    const cancelPending = vi.fn();
    manager.setOnSessionPendingWorkCancelled(cancelPending);

    await manager.start({
      session_id: "sess-cancel-active",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    const prompting = manager.prompt({
      session_id: "sess-cancel-active",
      turn_id: "turn-active",
      text: "run it",
    });
    await vi.waitFor(() => expect(fake.prompts).toHaveLength(1));

    manager.cancel("sess-cancel-active", "turn-active");
    expect(cancelPending).toHaveBeenCalledWith("sess-cancel-active");

    fake.releaseNext();
    await prompting;
  });

  it("coalesces concurrent starts for the same session into one ACP process", async () => {
    mocks.runtimeStart.mockClear();
    const fake = createControllableAcpSession();
    let release!: (session: AcpSession) => void;
    mocks.runtimeStart.mockImplementationOnce(
      () => new Promise<AcpSession>((resolve) => {
        release = resolve;
      }),
    );
    const manager = new SessionManager({
      send: vi.fn(),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({}),
      resolveAgentOverride: () => undefined,
    });
    const params = {
      session_id: "sess-concurrent-start",
      agent_id: "codex-acp",
      cwd: "/repo",
    };

    const first = manager.start(params);
    const second = manager.start(params);
    await vi.waitFor(() => {
      expect(mocks.runtimeStart).toHaveBeenCalledTimes(1);
    });
    release(fake.session);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(manager.sessionCount()).toBe(1);
    expect(firstResult).toMatchObject({
      status: "ready",
      session_id: "sess-concurrent-start",
      agent_id: "codex-acp",
      acp_session_id: "acp-session",
    });
    expect(secondResult).toEqual(firstResult);
  });

  it("returns a structured start error instead of requiring push-event timing", async () => {
    const send = vi.fn();
    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({}),
      resolveAgentOverride: () => undefined,
    });

    await expect(manager.start({
      session_id: "sess-no-agent",
      agent_id: "",
      cwd: "/repo",
    })).resolves.toEqual({
      status: "error",
      session_id: "sess-no-agent",
      message: "No agent selected. Pick an enabled agent and try again.",
    });
  });

  it("cancels an in-flight start without leaving a zombie ACP process", async () => {
    mocks.runtimeStart.mockClear();
    const fake = createControllableAcpSession();
    const dispose = vi.fn(async () => undefined);
    let release!: (session: AcpSession) => void;
    mocks.runtimeStart.mockImplementationOnce(
      () => new Promise<AcpSession>((resolve) => {
        release = resolve;
      }),
    );
    const send = vi.fn();
    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({}),
      resolveAgentOverride: () => undefined,
    });

    const starting = manager.start({
      session_id: "sess-cancelled-start",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    await vi.waitFor(() => {
      expect(mocks.runtimeStart).toHaveBeenCalledTimes(1);
    });
    const disposing = manager.dispose("sess-cancelled-start");
    release({ ...fake.session, dispose });
    await Promise.all([starting, disposing]);

    expect(dispose).toHaveBeenCalledOnce();
    expect(manager.sessionCount()).toBe(0);
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.ready" }),
    );
    expect(send).toHaveBeenCalledWith({
      type: "session.disposed",
      session_id: "sess-cancelled-start",
    });
  });

  it("bypasses the settings project for an explicitly managed global chat", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: vi.fn(),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({
        agentId: "codex-acp",
        cwd: "/default-project",
      }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-global-managed",
      agent_id: "codex-acp",
      workspace_mode: "managed",
    });

    expect(mocks.runtimeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({ cwd: "/tmp/backchat-test" }),
      }),
    );
  });

  it("gives Codex tool subprocesses a writable Fontconfig cache", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockClear();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: vi.fn(),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({}),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-fontconfig-cache",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    expect(mocks.runtimeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          env: expect.objectContaining({
            XDG_CACHE_HOME: expect.stringMatching(
              /^\/private\/tmp\/openma-acp-cache-\d+$/,
            ),
          }),
        }),
      }),
    );
  });

  it("leaves Codex feature configuration under the harness owner's control", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockClear();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: vi.fn(),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({}),
      resolveAgentOverride: () => ({
        envOverride: {
          CODEX_CONFIG: JSON.stringify({
            model_reasoning_effort: "high",
            features: { shell_tool: true },
          }),
        },
      }),
    });

    await manager.start({
      session_id: "sess-no-native-subagents",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const options = mocks.runtimeStart.mock.calls.at(-1)?.[0] as SessionOptions;
    expect(JSON.parse(options.agent.env?.CODEX_CONFIG ?? "{}")).toEqual({
      model_reasoning_effort: "high",
      features: {
        shell_tool: true,
      },
    });
  });

  it("rejects config-operation failures without terminally erroring the session", async () => {
    const fake = createControllableAcpSession();
    fake.session.setConfigOption = vi.fn(async () => {
      throw new Error("unsupported model");
    });
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const send = vi.fn();
    const manager = new SessionManager({
      send,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({}),
      resolveAgentOverride: () => undefined,
    });
    await manager.start({
      session_id: "sess-config-error",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    send.mockClear();

    await expect(manager.setConfigOption({
      session_id: "sess-config-error",
      config_id: "model",
      value: "missing",
    })).rejects.toThrow("unsupported model");
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.error" }),
    );
    expect(manager.sessionCount()).toBe(1);
  });

  it("classifies ACP event routes for boundary observability", () => {
    expect(
      acpEventUiRoute({
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Warning: Skill descriptions were shortened to fit the 2% skills context budget.",
        },
      }),
    ).toBe("composer_notice");
    expect(acpEventUiRoute({ sessionUpdate: "usage_update", used: 12 })).toBe(
      "session_state",
    );
    expect(
      acpEventUiRoute({
        sessionUpdate: "session_info_update",
        _meta: { codex: { threadStatus: { type: "idle" } } },
      }),
    ).toBe("session_metadata");
    expect(
      acpEventUiRoute({ sessionUpdate: "future_codex_event", payload: {} }),
    ).toBe("boundary");
  });

  it("never installs or updates an agent as part of session start", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    mocks.installAcpRegistryAgent.mockClear();
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "registry-agent" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-managed-install",
      agent_id: "registry-agent",
      cwd: "/repo",
    });

    expect(mocks.installAcpRegistryAgent).not.toHaveBeenCalled();
    expect(mocks.runtimeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          command: "registry-agent",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session.ready",
        session_id: "sess-managed-install",
      }),
    );
  });

  it("passes fork requests to the ACP runtime without treating fork as the subagent protocol", async () => {
    const fake = createControllableAcpSession({ supportsSessionFork: true });
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-subagent",
      agent_id: "codex-acp",
      cwd: "/repo",
      fork: { acp_session_id: "parent-acp-session" },
    } as never);

    expect(mocks.runtimeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        forkFromAcpSessionId: "parent-acp-session",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session.ready",
        session_id: "sess-subagent",
        supports_session_fork: true,
      }),
    );
  });

  it("builds MCP servers with the task id before starting the ACP runtime", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const resolveMcpServers = vi.fn((_agentId: string, taskId: string) => [
      {
        type: "http",
        name: "Backchat Browser",
        url: `http://127.0.0.1/browser/${taskId}`,
        headers: [],
      },
    ]);
    const manager = new SessionManager({
      send: vi.fn(),
      resolveMcpServers,
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "task-browser-window",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    expect(resolveMcpServers).toHaveBeenCalledWith(
      "codex-acp",
      "task-browser-window",
    );
    expect(mocks.runtimeStart).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: [
          expect.objectContaining({
            url: "http://127.0.0.1/browser/task-browser-window",
          }),
        ],
      }),
    );
  });

  it("flushes initial idle session state after session.ready", async () => {
    const fake = createControllableAcpSession({
      pendingEvents: [
        {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            {
              name: "review",
              description: "Review the current workspace",
            },
          ],
        },
      ],
    });
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "claude-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-slash",
      agent_id: "claude-acp",
      cwd: "/repo",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "session.ready",
        session_id: "sess-slash",
      }),
    );
    expect(events).toContainEqual({
      type: "session.event",
      session_id: "sess-slash",
      turn_id: "",
      event: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "review",
            description: "Review the current workspace",
          },
        ],
      },
    });
    expect(fake.drainCount()).toBe(1);
  });

  it("serializes prompts for one ACP session", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-queue",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const first = manager.prompt({
      session_id: "sess-queue",
      turn_id: "turn-1",
      text: "one",
    });
    const second = manager.prompt({
      session_id: "sess-queue",
      turn_id: "turn-2",
      text: "two",
    });

    await vi.waitUntil(() => fake.prompts.length === 1);
    expect(fake.prompts).toEqual([[{ type: "text", text: "one" }]]);

    fake.releaseNext();
    await first;
    await vi.waitUntil(() => fake.prompts.length === 2);

    expect(fake.prompts).toEqual([
      [{ type: "text", text: "one" }],
      [{ type: "text", text: "two" }],
    ]);

    fake.releaseNext();
    await second;

    expect(
      events
        .filter((event): event is { type: string; turn_id: string } =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: string }).type === "session.complete",
        )
        .map((event) => event.turn_id),
    ).toEqual(["turn-1", "turn-2"]);
  });

  it("converts prompt attachments into ACP content blocks", async () => {
    const fake = createControllableAcpSession({
      promptCapabilities: { image: true },
    });
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: () => undefined,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-attachments",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const prompt = manager.prompt({
      session_id: "sess-attachments",
      turn_id: "turn-attachments",
      text: "review this",
      attachments: [
        {
          id: "att-image",
          name: "screen.png",
          path: "/tmp/screen.png",
          uri: "file:///tmp/screen.png",
          kind: "image",
          mimeType: "image/png",
          size: 68,
          data: "iVBORw0KGgo=",
        },
        {
          id: "att-file",
          name: "notes.md",
          path: "/tmp/notes.md",
          uri: "file:///tmp/notes.md",
          kind: "file",
          mimeType: "text/markdown",
          size: 42,
        },
      ],
    });

    await vi.waitUntil(() => fake.prompts.length === 1);
    expect(fake.prompts).toEqual([
      [
        { type: "text", text: "review this" },
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
          uri: "file:///tmp/screen.png",
        },
        {
          type: "resource_link",
          uri: "file:///tmp/notes.md",
          name: "notes.md",
          mimeType: "text/markdown",
          size: 42,
        },
      ],
    ]);

    fake.releaseNext();
    await prompt;
  });

  it("serializes response annotations as hidden prompt context", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: () => undefined,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-annotations",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const prompt = manager.prompt({
      session_id: "sess-annotations",
      turn_id: "turn-annotations",
      text: "Please revise this.",
      annotations: [
        {
          id: "annotation-1",
          source_session_id: "sess-source",
          source_turn_id: "turn-source",
          text: "The selected assistant response",
          comment: "Be more specific here.",
        },
      ],
    });

    await vi.waitUntil(() => fake.prompts.length === 1);
    expect(fake.prompts).toEqual([
      [
        {
          type: "text",
          text: [
            "# Response annotations:",
            "Each item contains text selected from an earlier assistant response and may include a user comment. Use every selection as context and address every comment in your response.",
            "<response-annotations>",
            '[{"text":"The selected assistant response","annotation":"Be more specific here."}]',
            "</response-annotations>",
            "",
            "Please revise this.",
          ].join("\n"),
        },
      ],
    ]);

    fake.releaseNext();
    await prompt;
  });

  it("serializes browser element annotations with their screenshot context", async () => {
    const fake = createControllableAcpSession({
      promptCapabilities: { image: true },
    });
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: () => undefined,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-browser-annotation",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const browser = {
      url: "https://example.test/settings",
      title: "Settings",
      selector: "main > button#save",
      dom_path: "html > body > main > button:nth-of-type(1)",
      tag_name: "button",
      id: "save",
      class_names: ["primary"],
      role: "button",
      aria_label: "Save settings",
      text: "Save",
      attributes: { type: "submit" },
      outer_html: '<button id="save" type="submit">Save</button>',
      computed_styles: {
        color: "rgb(15, 17, 21)",
        background: "rgb(255, 255, 255)",
        opacity: "1",
        "font-family": "Inter, sans-serif",
        "font-size": "14px",
        "font-weight": "600",
        "line-height": "20px",
        "border-radius": "6px",
      },
      style_changes: [
        { property: "opacity", from: "1", to: "0.8" },
      ],
      rect: { x: 40, y: 80, width: 120, height: 36 },
      viewport: { width: 1280, height: 720, device_pixel_ratio: 2 },
      screenshot_name: "page-element-save.png",
    };
    const prompt = manager.prompt({
      session_id: "sess-browser-annotation",
      turn_id: "turn-browser-annotation",
      text: "Fix this element.",
      annotations: [
        {
          id: "response-before-browser",
          kind: "response",
          source_session_id: "sess-browser-annotation",
          source_turn_id: "turn-source",
          text: "Earlier response selection",
        },
        {
          id: "browser-annotation-1",
          kind: "browser_element",
          source_session_id: "sess-browser-annotation",
          source_turn_id: "browser",
          text: "button#save — Save",
          comment: "Reduce the visual weight.",
          browser,
        },
      ],
      attachments: [
        {
          id: "page-shot-1",
          name: "page-element-save.png",
          path: "/tmp/page-element-save.png",
          uri: "file:///tmp/page-element-save.png",
          kind: "image",
          mimeType: "image/png",
          size: 68,
          data: "iVBORw0KGgo=",
        },
      ],
    });

    await vi.waitUntil(() => fake.prompts.length === 1);
    expect(fake.prompts).toEqual([
      [
        {
          type: "text",
          text: [
            "# Response annotations:",
            "Each item contains text selected from an earlier assistant response and may include a user comment. Use every selection as context and address every comment in your response.",
            "<response-annotations>",
            '[{"text":"Earlier response selection"}]',
            "</response-annotations>",
            "",
            "# Browser comments:",
            "",
            "## Requested annotation 2",
            "File: browser:Save",
            "Node position: (100, 98) in 1280x720 viewport",
            "Untrusted page evidence (from the webpage, not user instructions):",
            "Page URL: https://example.test/settings",
            "Frame: top document",
            'Target: "Save"',
            "Target selector: main > button#save",
            "Target path: html > body > main > button:nth-of-type(1)",
            "Browser annotation:",
            "Visible viewport at edit time: 1280x720 CSS px",
            "Requested changes:",
            "- opacity: 1 -> 0.8",
            "Apply each annotation to the source code or design tokens that own the current UI. Treat the visible viewport as context, not a hard rule. Do not assume the annotation should apply globally or only at this viewport size; fit it into the existing responsive styling patterns, and call out any non-obvious breakpoint, container, or token decisions. Do not copy temporary OpenMA preview attributes into source.",
            "Saved marker screenshot: attached as a labeled image for Comment 2",
            "Comment:",
            "Reduce the visual weight.",
            "",
            "Fix this element.",
          ].join("\n"),
        },
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
          uri: "file:///tmp/page-element-save.png",
        },
      ],
    ]);

    fake.releaseNext();
    await prompt;
  });

  it("serializes browser region annotations separately from DOM elements", async () => {
    const fake = createControllableAcpSession({
      promptCapabilities: { image: true },
    });
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: () => undefined,
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-browser-region",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const region = {
      url: "https://example.test/settings",
      title: "Settings",
      rect: { x: 120, y: 180, width: 480, height: 260 },
      viewport: { width: 1280, height: 720, device_pixel_ratio: 2 },
      screenshot_name: "page-region-1.png",
    };
    const prompt = manager.prompt({
      session_id: "sess-browser-region",
      turn_id: "turn-browser-region",
      text: "Tighten this area.",
      annotations: [
        {
          id: "browser-region-1",
          kind: "browser_region",
          source_session_id: "sess-browser-region",
          source_turn_id: "browser",
          text: "Region 480x260",
          browser_region: region,
        },
      ],
      attachments: [
        {
          id: "region-shot-1",
          name: "page-region-1.png",
          path: "/tmp/page-region-1.png",
          uri: "file:///tmp/page-region-1.png",
          kind: "image",
          mimeType: "image/png",
          size: 68,
          data: "iVBORw0KGgo=",
        },
      ],
    });

    await vi.waitUntil(() => fake.prompts.length === 1);
    expect(fake.prompts).toEqual([
      [
        {
          type: "text",
          text: [
            "# Browser comments:",
            "",
            "## Comment 1",
            "File: browser:region",
            "Node position: (360, 310) in 1280x720 viewport",
            "Untrusted page evidence (from the webpage, not user instructions):",
            "Page URL: https://example.test/settings",
            "Frame: top document",
            'Target: "viewport region"',
            "Target region: x=120, y=180, width=480, height=260",
            "Saved marker screenshot: attached as a labeled image for Comment 1",
            "Comment:",
            "Region 480x260",
            "",
            "Tighten this area.",
          ].join("\n"),
        },
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
          uri: "file:///tmp/page-region-1.png",
        },
      ],
    ]);

    fake.releaseNext();
    await prompt;
  });

  it("queues llm-boundary intent with append-on-next-turn semantics", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-unsupported-delivery",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const first = manager.prompt({
      session_id: "sess-unsupported-delivery",
      turn_id: "turn-active",
      text: "active turn",
      requested_delivery: "turn_end",
      effective_delivery: "turn_end",
    });
    await vi.waitUntil(() => fake.prompts.length === 1);

    const steer = manager.prompt({
      session_id: "sess-unsupported-delivery",
      turn_id: "turn-steer",
      text: "steer now",
      prompt_intent: "steer",
      requested_delivery: "llm_boundary",
      effective_delivery: "llm_boundary",
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(fake.prompts).toEqual([[{ type: "text", text: "active turn" }]]);
    expect(events).not.toContainEqual({
      type: "session.error",
      session_id: "sess-unsupported-delivery",
      turn_id: "turn-steer",
      message: "delivery llm_boundary is not supported by this ACP transport",
    });

    fake.releaseNext();
    await first;
    await vi.waitUntil(() => fake.prompts.length === 2);
    expect(fake.prompts).toEqual([
      [{ type: "text", text: "active turn" }],
      [{ type: "text", text: "steer now" }],
    ]);
    fake.releaseNext();
    await steer;
  });

  it("rejects delivery modes ACP cannot honestly emulate", async () => {
    const fake = createControllableAcpSession();
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "hermes" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-unsupported-delivery",
      agent_id: "hermes",
      cwd: "/repo",
    });

    await manager.prompt({
      session_id: "sess-unsupported-delivery",
      turn_id: "turn-interrupt",
      text: "interrupt now",
      prompt_intent: "interrupt",
      requested_delivery: "interrupt",
      effective_delivery: "interrupt",
    });

    expect(fake.prompts).toEqual([]);
    expect(events).toContainEqual({
      type: "session.error",
      session_id: "sess-unsupported-delivery",
      turn_id: "turn-interrupt",
      message: "delivery interrupt is not supported by this ACP transport",
    });
  });

  it("persists streamed ACP events before the turn completes", async () => {
    const fake = createStreamingAcpSession([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "partial output" },
      },
    ]);
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-stream-durable",
      agent_id: "codex-acp",
      cwd: "/repo",
    });

    const prompt = manager.prompt({
      session_id: "sess-stream-durable",
      turn_id: "turn-stream",
      text: "stream please",
    });

    await vi.waitUntil(() =>
      events.some((event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: string }).type === "session.event",
      ),
    );

    expect(vi.mocked(appendEvent)).toHaveBeenCalledWith(
      "sess-stream-durable",
      "agent_message_chunk",
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "partial output" },
      },
    );
    expect(vi.mocked(appendEventsTx)).not.toHaveBeenCalledWith(
      "sess-stream-durable",
      expect.arrayContaining([
        expect.objectContaining({ type: "agent_message_chunk" }),
      ]),
    );

    fake.release();
    await prompt;
  });

  it("persists an agent-supplied session title", async () => {
    const fake = createStreamingAcpSession([
      {
        sessionUpdate: "session_info_update",
        title: "Repository overview",
      },
    ]);
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: vi.fn(),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "codex-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-agent-title",
      agent_id: "codex-acp",
      cwd: "/repo",
    });
    const prompt = manager.prompt({
      session_id: "sess-agent-title",
      turn_id: "turn-agent-title",
      text: "show repository",
    });
    fake.release();
    await prompt;

    expect(vi.mocked(setSessionTitle)).toHaveBeenCalledWith(
      "sess-agent-title",
      "Repository overview",
    );
  });

  it("persists discriminator-less ACP events as boundary diagnostics", async () => {
    const boundaryEvent = {
      type: "pi.experimental_status",
      payload: { phase: "warming_context" },
    };
    const fake = createStreamingAcpSession([boundaryEvent]);
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const manager = new SessionManager({
      send: vi.fn(),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "pi-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-boundary-observability",
      agent_id: "pi-acp",
      cwd: "/repo",
    });

    const prompt = manager.prompt({
      session_id: "sess-boundary-observability",
      turn_id: "turn-boundary-observability",
      text: "show adapter events",
    });
    fake.release();
    await prompt;

    expect(vi.mocked(appendEvent)).toHaveBeenCalledWith(
      "sess-boundary-observability",
      "acp_boundary:missing_discriminator",
      boundaryEvent,
    );
  });

  it("surfaces a silent ACP turn as an error instead of a successful empty response", async () => {
    const fake = createStreamingAcpSession([
      {
        sessionUpdate: "session_info_update",
        _meta: { piAcp: { running: true } },
      },
      {
        sessionUpdate: "session_info_update",
        _meta: { piAcp: { running: false } },
      },
    ]);
    mocks.runtimeStart.mockResolvedValueOnce(fake.session);
    const events: unknown[] = [];
    const manager = new SessionManager({
      send: (msg) => events.push(msg),
      resolveMcpServers: () => [],
      buildCallbacks: () => ({}),
      resolveDefaults: () => ({ agentId: "pi-acp" }),
      resolveAgentOverride: () => undefined,
    });

    await manager.start({
      session_id: "sess-silent",
      agent_id: "pi-acp",
      cwd: "/repo",
    });

    const prompt = manager.prompt({
      session_id: "sess-silent",
      turn_id: "turn-silent",
      text: "hello?",
    });
    fake.release();
    await prompt;

    expect(events).toContainEqual({
      type: "session.error",
      session_id: "sess-silent",
      turn_id: "turn-silent",
      message:
        "The agent finished without a response. Its provider may have rejected or rate-limited the request. Try again or choose another model.",
    });
    expect(events).not.toContainEqual({
      type: "session.complete",
      session_id: "sess-silent",
      turn_id: "turn-silent",
    });
  });

});

function createControllableAcpSession(opts: {
  promptCapabilities?: AcpSession["promptCapabilities"];
  supportsSessionFork?: boolean;
  pendingEvents?: unknown[];
} = {}): {
  session: AcpSession;
  prompts: unknown[];
  drainCount: () => number;
  releaseNext: () => void;
} {
  const prompts: unknown[] = [];
  const releases: Array<() => void> = [];
  let pendingEvents = [...(opts.pendingEvents ?? [])];
  let drainCount = 0;
  const session: AcpSession = {
    id: "runtime-session",
    acpSessionId: "acp-session",
    options: {} as SessionOptions,
    authMethods: [],
    agentInfo: null,
    configOptions: [],
    prompt(input: string | readonly unknown[]): AsyncIterable<unknown> {
      prompts.push(typeof input === "string" ? input : [...input]);
      let release!: () => void;
      const done = new Promise<void>((resolve) => {
        release = resolve;
      });
      releases.push(release);
      return (async function* () {
        await done;
      })();
    },
    drainPendingEvents() {
      drainCount++;
      const events = pendingEvents;
      pendingEvents = [];
      return events;
    },
    async setConfigOption() {
      return [];
    },
    async authenticate() {
      return;
    },
    async setMode() {
      return;
    },
    promptCapabilities: opts.promptCapabilities ?? {},
    supportsSessionFork: opts.supportsSessionFork ?? false,
    isAlive() {
      return true;
    },
    async dispose() {
      return;
    },
  };

  return {
    session,
    prompts,
    drainCount: () => drainCount,
    releaseNext: () => {
      const release = releases.shift();
      if (!release) throw new Error("no prompt waiting");
      release();
    },
  };
}

function createStreamingAcpSession(events: unknown[]): {
  session: AcpSession;
  release: () => void;
} {
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session: AcpSession = {
    id: "runtime-session",
    acpSessionId: "acp-session",
    options: {} as SessionOptions,
    authMethods: [],
    agentInfo: null,
    configOptions: [],
    prompt(): AsyncIterable<unknown> {
      return (async function* () {
        for (const event of events) yield event;
        await done;
      })();
    },
    drainPendingEvents() {
      return [];
    },
    async setConfigOption() {
      return [];
    },
    async authenticate() {
      return;
    },
    async setMode() {
      return;
    },
    promptCapabilities: {},
    supportsSessionFork: false,
    isAlive() {
      return true;
    },
    async dispose() {
      return;
    },
  };
  return { session, release };
}
