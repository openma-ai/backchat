import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

import { runCli } from "../../cli/backchat.mjs";
import { createSessionEventEnricher } from "../session-event-enricher.js";
import { deliverSessionEvent } from "../session-event-delivery.js";
import { appendEvent, closeSessionDb, getSession, openSessionDb } from "../sql-store.js";
import { requestPermission } from "../brokers.js";
import { SessionManager } from "../session-manager.js";
import { publishControlLiveEvent, streamEventsFromSession } from "./live-bus.js";
import { createControlApi } from "./handlers.js";
import { startControlServer } from "./server.js";

const roots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
const managers: SessionManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.disposeAll()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  closeSessionDb();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("control CLI against the fake ACP agent", () => {
  it("starts a session, streams a reply, and keeps the caller on the session", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-fake-acp-"));
    roots.push(root);
    openSessionDb(join(root, "sessions.db"));
    const enrich = createSessionEventEnricher(() => new Date().toISOString());
    const manager = new SessionManager({
      send: (message) => {
        const enriched = enrich(message);
        for (const event of streamEventsFromSession(enriched)) publishControlLiveEvent(event);
        deliverSessionEvent(enriched, {
          publish: () => undefined,
          persist: (event) => appendEvent(event.session_id, "openma_event", event),
        });
      },
      resolveMcpServers: () => [],
      buildCallbacks: (sessionId) => ({
        requestPermission: (params) => requestPermission(sessionId, params, "fake-cli") as Promise<never>,
      }),
      resolveDefaults: () => ({ permissionMode: "ask", promptQueueEnabled: true }),
      resolveAgentOverride: (agentId) => agentId === "fake-cli"
        ? {
          commandOverride: process.execPath,
          argsOverride: [resolve("e2e/fixtures/fake-acp-agent.mjs")],
        }
        : undefined,
    });
    managers.push(manager);
    const socketPath = join(root, "control.sock");
    servers.push(await startControlServer({
      socketPath,
      api: createControlApi({ sessions: manager }),
    }));
    const env = { BACKCHAT_CONTROL_SOCK: socketPath, BACKCHAT_CLIENT: "cursor killer" };
    const out: string[] = [];
    const io = {
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => out.push(line),
    };

    expect(await runCli([
      "session", "start",
      "--agent", "fake-cli",
      "--root", root,
      "--approve", "auto-read",
      "--json",
    ], env, io)).toBe(0);
    const started = JSON.parse(out.at(-1)!) as { session_id: string; status: string };
    expect(started.status).toBe("ready");
    expect(getSession(started.session_id)?.external_client).toBe("cursor killer");

    out.length = 0;
    expect(await runCli([
      "session", "send", started.session_id, "hello from cli",
      "--stream",
      "--timeout", "20",
    ], env, io)).toBe(0);
    const events = out.join("\n").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "message_delta" && String(event.text).includes("Fake response"))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "result", status: "complete" });

    out.length = 0;
    expect(await runCli([
      "session", "transcript", started.session_id, "--json",
    ], env, io)).toBe(0);
    const transcript = JSON.parse(out.at(-1)!) as { events: Array<{ cursor: string; role: string; type: string; text?: string }> };
    expect(transcript.events.some((event) => event.role === "assistant" && event.text?.includes("Fake response"))).toBe(true);
    const cursor = transcript.events.at(-1)!.cursor;
    out.length = 0;
    expect(await runCli([
      "session", "transcript", started.session_id, "--since", cursor, "--json",
    ], env, io)).toBe(0);
    expect(JSON.parse(out.at(-1)!).events).toEqual([]);

    out.length = 0;
    expect(await runCli(["session", "list", "--json"], env, io)).toBe(0);
    expect(JSON.parse(out.at(-1)!)).toEqual([
      expect.objectContaining({ id: started.session_id, external_client: "cursor killer" }),
    ]);
  }, 20_000);

  it("runs project, session, and task management from the CLI alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-cli-loop-"));
    roots.push(root);
    openSessionDb(join(root, "sessions.db"));
    const enrich = createSessionEventEnricher(() => new Date().toISOString());
    const manager = new SessionManager({
      send: (message) => {
        const enriched = enrich(message);
        deliverSessionEvent(enriched, {
          publish: () => undefined,
          persist: (event) => appendEvent(event.session_id, "openma_event", event),
        });
      },
      resolveMcpServers: () => [],
      buildCallbacks: (sessionId) => ({
        requestPermission: (params) => requestPermission(sessionId, params, "fake-cli") as Promise<never>,
      }),
      resolveDefaults: () => ({ permissionMode: "ask", promptQueueEnabled: true }),
      resolveAgentOverride: (agentId) => agentId === "fake-cli"
        ? {
          commandOverride: process.execPath,
          argsOverride: [resolve("e2e/fixtures/fake-acp-agent.mjs")],
        }
        : undefined,
    });
    managers.push(manager);
    const submit = vi.fn(async () => {
      throw new Error("Configure this project first");
    });
    const socketPath = join(root, "control.sock");
    servers.push(await startControlServer({
      socketPath,
      api: createControlApi({
        sessions: manager,
        work: {
          submit,
          view: async () => ({ config: null, facts: { sessions: [] } }),
          goal: async () => null,
        },
      }),
    }));
    const env = { BACKCHAT_CONTROL_SOCK: socketPath, BACKCHAT_CLIENT: "cursor killer" };
    const out: string[] = [];
    const io = {
      stdout: (line: string) => out.push(line),
      stderr: (line: string) => out.push(`stderr:${line}`),
    };
    const run = async (args: string[]) => {
      out.length = 0;
      const code = await runCli(args, env, io);
      return { code, body: out.filter((line) => !line.startsWith("stderr:")).join("\n") };
    };

    const created = await run(["project", "create", "--json", "--name", "loop", "--source", root]);
    expect(created.code).toBe(0);
    const projectId = JSON.parse(created.body).id as string;

    const started = await run([
      "session", "start", "--json", "--root", root, "--agent", "fake-cli", "--project", projectId,
    ]);
    expect(started.code).toBe(0);
    const sessionId = JSON.parse(started.body).session_id as string;

    const sent = await run(["session", "send", sessionId, "hello from the loop", "--wait", "--timeout", "20", "--json"]);
    expect(sent.code).toBe(0);
    expect(JSON.parse(sent.body).reply).toContain("Fake response saved for hello from the loop");

    const sessions = await run(["session", "list", "--project", projectId, "--json"]);
    expect(JSON.parse(sessions.body)).toEqual([
      expect.objectContaining({ id: sessionId, external_client: "cursor killer" }),
    ]);

    const submitted = await run([
      "work", "submit", "--json", "--project", projectId, "--text", "Review the branch",
    ]);
    expect(submitted.code).toBe(0);
    expect(submit).not.toHaveBeenCalled();
    const taskId = JSON.parse(submitted.body).task.id as string;

    const listed = await run(["work", "list", "--project", projectId, "--json"]);
    expect(JSON.parse(listed.body).tasks).toEqual([
      expect.objectContaining({ id: taskId, text: "Review the branch", coordinator_name: "cursor killer" }),
    ]);
    const steered = await run([
      "work", "steer", "--json", "--project", projectId, "--task", taskId, "--text", "Skip generated files",
    ]);
    expect(steered.code).toBe(0);
    const transcript = await run(["work", "transcript", "--json", "--project", projectId, "--task", taskId]);
    expect(JSON.parse(transcript.body).events.map((event: { text?: string }) => event.text)).toEqual([
      "Review the branch",
      "Skip generated files",
    ]);
    const cancelled = await run(["work", "cancel", "--json", "--project", projectId, "--task", taskId]);
    expect(JSON.parse(cancelled.body).status).toBe("cancelled");
  }, 20_000);

  it("reproduces Cursor's direct edits and only allows them after an explicit opt-in", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-cursor-edits-"));
    roots.push(root);
    const harness = await startCursorHarness(root);
    const autoRead = await harness.run([
      "session", "start", "--json", "--root", root, "--agent", "cursor", "--approve", "auto-read",
    ]);
    expect(autoRead.code).toBe(0);
    const readOnly = jsonBody(autoRead.body) as { session_id: string; modes?: { currentModeId?: string } };
    expect(readOnly.modes?.currentModeId).toBe("ask");
    const refused = await harness.run([
      "session", "send", readOnly.session_id, "cursor-direct-edit", "--wait", "--timeout", "20", "--json",
    ]);
    expect(refused.code).toBe(0);
    expect(String(jsonBody(refused.body).reply)).toContain("ask mode refuses writes");
    await expect(access(join(root, "CURSOR_DIRECT_EDIT.md"))).rejects.toThrow();
    await expect(access(join(root, ".cursor", "cli.json"))).rejects.toThrow();
    expect(harness.fsWrites).toEqual([]);
    expect(harness.permissions).toEqual([]);

    const autoAll = await harness.run([
      "session", "start", "--json", "--root", root, "--agent", "cursor", "--approve", "auto-all",
    ]);
    expect(autoAll.code).toBe(0);
    const writing = jsonBody(autoAll.body) as { session_id: string; modes?: { currentModeId?: string } };
    expect(writing.modes?.currentModeId).toBe("agent");
    harness.fsWrites.length = 0;
    harness.permissions.length = 0;
    const edited = await harness.run([
      "session", "send", writing.session_id, "cursor-direct-edit", "--stream", "--timeout", "20",
    ]);
    expect(edited.code).toBe(0);
    const stream = jsonLines(edited.body) as Array<{ type?: string; outcome?: string; status?: string }>;
    expect(stream.some((event) => event.type === "permission")).toBe(false);
    expect(stream).toContainEqual(expect.objectContaining({ type: "tool_call", status: "end", outcome: "ok" }));
    await access(join(root, "CURSOR_DIRECT_EDIT.md"));
    expect(harness.fsWrites).toEqual([]);
    expect(harness.permissions).toEqual([]);

    const denied = harness.run([
      "session", "send", readOnly.session_id, "cursor-reject-shell", "--stream", "--timeout", "20",
    ]);
    const requestId = await harness.requestId(readOnly.session_id);
    expect(await harness.run([
      "session", "respond", readOnly.session_id, requestId, "reject-once", "--json",
    ])).toMatchObject({ code: 0 });
    const deniedResult = await denied;
    expect(deniedResult.code).toBe(0);
    const deniedStream = jsonLines(deniedResult.body) as Array<{ outcome?: string }>;
    expect(deniedStream).toContainEqual(expect.objectContaining({ outcome: "denied" }));
    const transcript = await harness.run(["session", "transcript", readOnly.session_id, "--json"]);
    const rows = jsonBody(transcript.body).events as Array<{ type?: string; tool_call_id?: string; status?: string }>;
    expect(rows).toContainEqual(expect.objectContaining({
      type: "tool_result",
      tool_call_id: "shell-1",
      status: "denied",
    }));
  }, 30_000);

  it("answers cursor/create_plan in plan mode without writing or throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-cursor-plan-"));
    roots.push(root);
    const harness = await startCursorHarness(root, "agent,plan");
    const started = await harness.run([
      "session", "start", "--json", "--root", root, "--agent", "cursor", "--approve", "ask",
    ]);
    expect(started.code).toBe(0);
    const session = jsonBody(started.body) as { session_id: string; modes?: { currentModeId?: string } };
    expect(session.modes?.currentModeId).toBe("plan");
    const pending = harness.run([
      "session", "send", session.session_id, "cursor-direct-edit", "--wait", "--timeout", "20", "--json",
    ]);
    const requestId = await harness.requestId(session.session_id);
    expect(await harness.run([
      "session", "respond", session.session_id, requestId, "accept", "--json",
    ])).toMatchObject({ code: 0 });
    const planned = await pending;
    expect(planned.code).toBe(0);
    expect(String(jsonBody(planned.body).reply)).toContain("plan only");
    await expect(access(join(root, "CURSOR_DIRECT_EDIT.md"))).rejects.toThrow();
    expect(harness.fsWrites).toEqual([]);
  }, 30_000);
});

function jsonLines(body: string): Array<Record<string, unknown>> {
  return body.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function jsonBody(body: string): Record<string, unknown> {
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(body || "empty CLI response");
  return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
}

async function startCursorHarness(root: string, modes?: string) {
  openSessionDb(join(root, "sessions.db"));
  const fsWrites: unknown[] = [];
  const permissions: unknown[] = [];
  const enrich = createSessionEventEnricher(() => new Date().toISOString());
  const manager = new SessionManager({
    send: (message) => {
      const enriched = enrich(message);
      for (const event of streamEventsFromSession(enriched)) publishControlLiveEvent(event);
      deliverSessionEvent(enriched, {
        publish: () => undefined,
        persist: (event) => appendEvent(event.session_id, "openma_event", event),
      });
    },
    resolveMcpServers: () => [],
    buildCallbacks: (sessionId) => ({
      requestPermission: (params) => {
        permissions.push(params);
        return requestPermission(sessionId, params, "cursor") as Promise<never>;
      },
      writeTextFile: async (params) => {
        fsWrites.push(params);
        return {};
      },
    }),
    resolveDefaults: () => ({ permissionMode: "ask", promptQueueEnabled: true }),
    resolveAgentOverride: (agentId) => agentId === "cursor"
      ? {
        commandOverride: process.execPath,
        argsOverride: [resolve("e2e/fixtures/fake-acp-agent.mjs")],
        envOverride: {
          BACKCHAT_FAKE_CURSOR: "1",
          ...(modes ? { BACKCHAT_FAKE_CURSOR_MODES: modes } : {}),
        },
      }
      : undefined,
  });
  managers.push(manager);
  const socketPath = join(root, "control.sock");
  servers.push(await startControlServer({
    socketPath,
    api: createControlApi({ sessions: manager }),
  }));
  const env = { BACKCHAT_CONTROL_SOCK: socketPath };
  return {
    fsWrites,
    permissions,
    async run(args: string[]) {
      const lines: string[] = [];
      const code = await runCli(args, env, {
        stdout: (line: string) => lines.push(line),
        stderr: (line: string) => lines.push(line),
      });
      return { code, body: lines.join("\n") };
    },
    async requestId(sessionId: string) {
      let id = "";
      await vi.waitFor(async () => {
        const lines: string[] = [];
        const listed = await runCli(["session", "pending", sessionId, "--json"], env, {
          stdout: (line: string) => lines.push(line),
          stderr: () => undefined,
        });
        expect(listed).toBe(0);
        const parsed = JSON.parse(lines.at(-1) ?? "{}") as { requests?: Array<{ id: string }> };
        id = parsed.requests?.[0]?.id ?? "";
        expect(id).not.toBe("");
      }, { timeout: 15_000, interval: 50 });
      return id;
    },
  };
}
