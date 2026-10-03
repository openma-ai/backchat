import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { decodeCursorCloudRunStreamEvent } from "@openma/common/protocol/cursor-cloud";
import type { OpenMAEvent } from "@openma/common/session-events/openma";
import { DirectAgentRuntime } from "./direct-agent-runtime.js";
import { CursorCloudRequestError, resetCursorRepositoryCache } from "./cursor-cloud-client.js";

const AGENT = "bc-00000000-0000-0000-0000-000000000001";
const commonRoot = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/@openma/common");

afterEach(() => resetCursorRepositoryCache());

function runtime(fetchImpl: typeof fetch) {
  return new DirectAgentRuntime({
    provider: "cursor-cloud",
    baseUrl: "https://api.cursor.com/",
    apiKey: "cursor-key",
    fetchImpl,
  });
}

function basic(): string {
  return `Basic ${Buffer.from("cursor-key:", "utf8").toString("base64")}`;
}

describe("cursor cloud direct runtime", () => {
  it("uses the v0.7.3 Electron signal guard and the cursor decoder export", () => {
    const pkg = JSON.parse(readFileSync(join(commonRoot, "package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe("0.7.3");
    const source = readFileSync(join(commonRoot, "dist/acp-runtime/spawners/node.js"), "utf8");
    expect(source).toContain("function isElectronMainProcess");
    expect(source).toContain('type === "browser"');
  });

  it("lists models and caches repositories inside the per-minute window", async () => {
    const calls: string[] = [];
    const client = runtime(async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      expect(new Headers(init?.headers).get("authorization")).toBe(basic());
      if (url.pathname === "/v1/models") return Response.json({ items: [{ id: "composer-2", displayName: "Composer 2" }] });
      if (url.pathname === "/v1/repositories") return Response.json({ items: [{ url: "https://github.com/demo/app" }] });
      return new Response("no", { status: 404 });
    });
    const first = await client.catalog();
    const second = await client.catalog();
    expect(first.cloudAgents).toEqual([{ id: "default", name: "Default" }, { id: "composer-2", name: "Composer 2" }]);
    expect(first.environments).toEqual([{ id: "cloud", name: "Cursor Cloud", type: "cloud", runtimeId: null }]);
    expect(first.repositories).toEqual([{ url: "https://github.com/demo/app" }]);
    expect(second.repositories).toEqual(first.repositories);
    expect(calls.filter((path) => path === "/v1/repositories")).toHaveLength(1);
  });

  it("creates the agent on the first message and does not post a duplicate after agent_id_conflict", async () => {
    const bodies: unknown[] = [];
    let conflict = false;
    const client = runtime(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === `/v1/agents/${AGENT}` && init?.method !== "POST") {
        if (!conflict) return new Response("missing", { status: 404 });
        return Response.json({ id: AGENT, status: "ACTIVE", latestRunId: "run-1", createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", env: { type: "cloud" } });
      }
      if (url.pathname === "/v1/agents" && init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
        conflict = true;
        return Response.json({ error: { code: "agent_id_conflict", message: "exists" } }, { status: 409 });
      }
      throw new Error(`unexpected ${init?.method} ${url.pathname}`);
    });
    const created = await client.createRemoteSession({ agentId: "composer-2", environmentId: "cloud", title: "Read me", cursor: { repoUrl: "git@github.com:demo/app.git", startingRef: "main" } });
    expect(created.id).toMatch(/^bc-[0-9a-f-]{36}$/i);
    expect(bodies).toEqual([]);
    const result = await client.sendEvent(AGENT, {
      type: "user.message",
      content: [{ type: "text", text: "Read the README" }],
      metadata: { "backchat.cursor.model": "composer-2", "backchat.cursor.repo": "git@github.com:demo/app.git", "backchat.cursor.branch": "main", "backchat.cursor.title": "Read me" },
    });
    expect(result).toEqual({ runId: "run-1" });
    expect(bodies).toEqual([{
      agentId: AGENT,
      prompt: { text: "Read the README" },
      name: "Read me",
      model: { id: "composer-2" },
      repos: [{ url: "https://github.com/demo/app", startingRef: "main" }],
    }]);
  });

  it("sends a follow-up only when the agent exists and surfaces agent_busy", async () => {
    const posts: string[] = [];
    const client = runtime(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === `/v1/agents/${AGENT}` && (!init?.method || init.method === "GET")) {
        return Response.json({ id: AGENT, name: "Read me", status: "IDLE", latestRunId: "run-1", createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:01.000Z", env: { type: "cloud" }, url: "https://cursor.com/agents/" + AGENT });
      }
      if (url.pathname.endsWith("/runs") && init?.method === "POST") {
        posts.push(String(init.body));
        return Response.json({ error: { code: "agent_busy", message: "running" } }, { status: 409 });
      }
      if (url.pathname.endsWith("/cancel")) {
        posts.push("cancel");
        return Response.json({ id: "run-1" });
      }
      throw new Error(`unexpected ${init?.method} ${url.pathname}`);
    });
    await expect(client.sendEvent(AGENT, { type: "user.message", content: "next" })).rejects.toMatchObject({ busy: true, status: 409, code: "agent_busy" });
    expect(posts).toEqual([JSON.stringify({ prompt: { text: "next" } })]);
    await expect(client.sendEvent(AGENT, { type: "user.custom_tool_result", content: "no" })).rejects.toBeInstanceOf(CursorCloudRequestError);
    await expect(client.sendEvent(AGENT, { type: "user.interrupt" })).resolves.toEqual({ runId: "run-1" });
    expect(posts).toContain("cancel");
  });

  it("decodes a run stream through openma-common, resumes with Last-Event-ID, and drops the resent status", async () => {
    let streams = 0;
    const client = runtime(async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      if (url.pathname === `/v1/agents/${AGENT}`) {
        return Response.json({ id: AGENT, status: "ACTIVE", latestRunId: "run-1", createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", env: { type: "cloud" } });
      }
      if (url.pathname.endsWith("/stream")) {
        streams += 1;
        if (streams === 1) {
          expect(headers.get("last-event-id")).toBeNull();
          const body = [
            "event: status",
            'data: {"runId":"run-1","status":"RUNNING"}',
            "",
            "id: 10-0",
            "event: assistant",
            'data: {"text":"Hi"}',
            "",
          ].join("\n");
          return new Response(body, { headers: { "content-type": "text/event-stream" } });
        }
        expect(headers.get("last-event-id")).toBe("10-0");
        const body = [
          "event: status",
          'data: {"runId":"run-1","status":"RUNNING"}',
          "",
          "id: 10-0",
          "event: assistant",
          'data: {"text":"Hi"}',
          "",
          "id: 11-0",
          "event: thinking",
          'data: {"text":"Looking"}',
          "",
          "id: 12-0",
          "event: tool_call",
          'data: {"callId":"call-1","name":"read_file","status":"completed","args":{"path":"README.md"},"result":{"success":true}}',
          "",
          "id: 13-0",
          "event: result",
          'data: {"runId":"run-1","status":"FINISHED","text":"Hi","git":{"branches":[{"repoUrl":"github.com/demo/app","branch":"cursor/readme","prUrl":"https://github.com/demo/app/pull/7"}]}}',
          "",
          "id: 14-0",
          "event: done",
          "data: {}",
          "",
        ].join("\n");
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    const controller = new AbortController();
    const events: Array<{ type: string; canonical: OpenMAEvent }> = [];
    try {
      for await (const event of client.stream(AGENT, { signal: controller.signal })) {
        events.push(event as { type: string; canonical: OpenMAEvent });
        if (event.type === "vendor.event") {
          controller.abort();
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
    }
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "agent.message_chunk",
      "agent.thinking",
      "tool.completed",
      "turn.completed",
      "vendor.event",
    ]);
    const assistant = decodeCursorCloudRunStreamEvent(
      { event: "assistant", id: "10-0", data: { text: "Hi" } },
      { sessionId: AGENT, turnId: "run-1", now: () => events[1]!.canonical.occurred_at },
    )[0]!;
    expect(events[1]!.canonical).toEqual(assistant);
    expect(events[5]!.canonical).toMatchObject({ type: "vendor.event", data: { name: "git", harness: "cursor-cloud" } });
    expect(streams).toBe(2);
  });

  it("reads the terminal run when the stream has expired", async () => {
    const client = runtime(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === `/v1/agents/${AGENT}`) {
        return Response.json({ id: AGENT, status: "ACTIVE", latestRunId: "run-1", createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", env: { type: "cloud" } });
      }
      if (url.pathname.endsWith("/stream")) return new Response("gone", { status: 410 });
      if (url.pathname.endsWith("/runs/run-1")) {
        return Response.json({ id: "run-1", status: "FINISHED", result: "Done", durationMs: 12, git: { branches: [{ branch: "cursor/readme", prUrl: "https://github.com/demo/app/pull/7" }] } });
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    const controller = new AbortController();
    const events = [];
    try {
      for await (const event of client.stream(AGENT, { signal: controller.signal })) {
        events.push(event);
        if (event.type === "vendor.event") {
          controller.abort();
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
    }
    expect(events.map((event) => event.type)).toEqual(["turn.completed", "vendor.event"]);
  });

  it("prefers local history and otherwise replays v0 messages through the decoder", async () => {
    const calls: string[] = [];
    const client = runtime(async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname.endsWith("/conversation")) {
        return Response.json({ id: AGENT, messages: [
          { id: "unstable-1", type: "user_message", text: "Hello" },
          { id: "unstable-2", type: "assistant_message", text: "Hi there" },
        ] });
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    const skipped = [];
    for await (const event of client.history(AGENT, { preferLocal: true })) skipped.push(event);
    expect(skipped).toEqual([]);
    expect(calls).toEqual([]);
    const events = [];
    for await (const event of client.history(AGENT)) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["user.message", "agent.message_chunk"]);
    expect(events.map((event) => (event.canonical as OpenMAEvent).data)).toEqual([
      expect.objectContaining({ text: "Hello" }),
      expect.objectContaining({ text: "Hi there" }),
    ]);
    const again = [];
    for await (const event of client.history(AGENT)) again.push(event.id);
    expect(again).toEqual(events.map((event) => event.id));
  });
});
