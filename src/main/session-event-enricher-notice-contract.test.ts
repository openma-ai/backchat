import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { attachOpenMAEvent } from "../shared/openma-event.js";
import { configureAppLog, flushAppLog } from "./app-log.js";
import { createSessionEventEnricher } from "./session-event-enricher.js";

describe("session event enricher system notice logging", () => {
  it("logs an out-of-turn Codex warning projected by the enricher", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-enricher-notice-"));
    configureAppLog(root);
    try {
      const enrich = createSessionEventEnricher(
        () => "2026-10-10T00:00:00.000Z",
      );
      enrich({
        type: "session.ready",
        session_id: "sess-enricher-notice",
        acp_session_id: "acp-enricher-notice",
        agent_id: "codex-acp",
        cwd: "/repo",
      });
      const warning = "Warning: Codex could not save diagnostic logs.";
      const result = enrich({
        type: "session.event",
        session_id: "sess-enricher-notice",
        turn_id: "",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: warning },
        },
      });
      await flushAppLog();

      const raw = await readFile(join(root, "logs", "backchat.log"), "utf8");
      const entries = raw.trim().split("\n").filter(Boolean).map((line) =>
        JSON.parse(line) as Record<string, unknown>
      );
      expect(result.openma_event).toMatchObject({
        type: "system.notice",
        data: { message: warning, tone: "warning" },
      });
      expect(entries).toContainEqual(expect.objectContaining({
        event: "acp.system_notice",
        session_id: "sess-enricher-notice",
        agent_id: "codex-acp",
        turn_id: "",
        out_of_turn: true,
        message: warning,
      }));

      enrich({
        type: "session.event",
        session_id: "sess-enricher-notice",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: warning },
        },
      } as unknown as Parameters<typeof enrich>[0]);
      await flushAppLog();
      const updated = await readFile(join(root, "logs", "backchat.log"), "utf8");
      expect(updated.trim().split("\n")).toHaveLength(2);
    } finally {
      configureAppLog(null);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not log a normal ACP text chunk", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-enricher-chunk-"));
    configureAppLog(root);
    try {
      const enrich = createSessionEventEnricher(
        () => "2026-10-10T00:00:00.000Z",
      );
      enrich({
        type: "session.ready",
        session_id: "sess-enricher-chunk",
        acp_session_id: "acp-enricher-chunk",
        agent_id: "codex-acp",
        cwd: "/repo",
      });
      const result = enrich({
        type: "session.event",
        session_id: "sess-enricher-chunk",
        turn_id: "turn-enricher-chunk",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "The answer is ready." },
        },
      });
      enrich(attachOpenMAEvent({
        type: "session.event",
        session_id: "sess-enricher-chunk",
        turn_id: "",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Warning: Codex could not save diagnostic logs.",
          },
        },
      }, {
        occurredAt: "2026-10-10T00:00:00.000Z",
        harness: "codex-acp",
        adapter: "acp",
      }));
      enrich({
        type: "session.event",
        session_id: "sess-enricher-chunk",
        turn_id: "turn-unprojected-event",
        event: {},
      });
      await flushAppLog();

      expect(result.openma_event?.type).toBe("agent.message_chunk");
      await expect(
        readFile(join(root, "logs", "backchat.log"), "utf8"),
      ).rejects.toThrow();
    } finally {
      configureAppLog(null);
      await rm(root, { recursive: true, force: true });
    }
  });
});
