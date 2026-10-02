import { mkdtemp, rm } from "node:fs/promises";
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
});
