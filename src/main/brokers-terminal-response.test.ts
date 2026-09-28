import { decodeAcpClientResponse } from "@openma/common/protocol/acp";
import { OpenMAEventSchema } from "@openmatter/agent";
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));

import {
  cancelPendingFor,
  createTerminal,
  killTerminal,
  releaseTerminal,
  terminalSnapshot,
  waitForTerminalExit,
} from "./brokers.js";
import { toOpenMAEvent } from "../shared/openma-event.js";

const sessionId = "terminal-response-session";
afterEach(() => cancelPendingFor(sessionId));

describe.each([
  { method: "terminal/kill", invoke: killTerminal },
  { method: "terminal/release", invoke: releaseTerminal },
])("$method response contract", ({ method, invoke }) => {
  it.each(["running", "exited", "absent"] as const)(
    "keeps the successful %s callback valid through canonical event validation",
    async (state) => {
      const terminalId = state === "absent"
        ? "missing-terminal"
        : createTerminal(sessionId, process.cwd(), {
            command: process.execPath,
            args: ["-e", state === "exited" ? "process.exit(0)" : "setInterval(() => {}, 1000)"],
          }).terminalId;
      if (state === "exited") await waitForTerminalExit({ terminalId });
      // Register before release removes the terminal from the broker registry.
      const exited = waitForTerminalExit({ terminalId });
      const result = invoke({ terminalId });
      await exited;

      const decoded = decodeAcpClientResponse(
        { id: "terminal-callback", result },
        {
          eventId: "terminal-response",
          sessionId,
          turnId: "worker-turn",
          method,
          seq: 25,
          occurredAt: "2026-09-22T04:49:05.723Z",
        },
      );
      expect(Schema.is(OpenMAEventSchema)(decoded.event)).toBe(true);
      expect(decoded.event).toMatchObject({
        type: "callback.completed",
        data: { method, category: "terminal", result: {} },
      });

      // The desktop also retains the original callback response as raw evidence.
      const event = toOpenMAEvent({
        type: "session.event",
        session_id: sessionId,
        turn_id: "worker-turn",
        event: {
          type: "acp.client_response",
          requestId: "terminal-callback",
          method,
          result,
        },
      }, { occurredAt: "2026-09-22T04:49:05.723Z", harness: "pi-acp", adapter: "acp" });
      expect(Schema.is(OpenMAEventSchema)(event)).toBe(true);
      expect(event?.raw?.payload).toMatchObject({ result: {} });

      if (method === "terminal/release" || state === "absent") {
        expect(terminalSnapshot(terminalId)).toBeNull();
      } else {
        expect(terminalSnapshot(terminalId)).toMatchObject({ terminalId, exited: true });
      }
    },
  );
});
