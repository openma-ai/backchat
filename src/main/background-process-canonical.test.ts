import { afterEach, describe, expect, it, vi } from "vitest";
import { reduceWorkItems, type OpenMAEvent } from "@openma/common/session-events/openma";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));

import {
  createTerminal,
  killTerminal,
  releaseTerminal,
  setBrokerSessionEventSink,
  waitForTerminalExit,
} from "./brokers";
import { attachOpenMAEvent } from "../shared/openma-event.js";

const terminalIds = new Set<string>();

afterEach(() => {
  setBrokerSessionEventSink(undefined);
  for (const terminalId of terminalIds) {
    releaseTerminal({ terminalId });
  }
  terminalIds.clear();
});

function captureCanonicalEvents(): OpenMAEvent[] {
  const events: OpenMAEvent[] = [];
  setBrokerSessionEventSink((message) => {
    const enriched = attachOpenMAEvent(message, {
      occurredAt: new Date().toISOString(),
      adapter: "acp-terminal",
    });
    if (enriched.openma_event) events.push(enriched.openma_event);
  });
  return events;
}

describe("ACP terminal canonical background lifecycle", () => {
  it("emits start, output and successful completion for a real command process", async () => {
    const events = captureCanonicalEvents();
    const { terminalId } = createTerminal("sess-terminal", process.cwd(), {
      command: process.execPath,
      args: ["-e", "process.stdout.write('terminal output')"],
    });
    terminalIds.add(terminalId);

    await waitForTerminalExit({ terminalId });

    const item = reduceWorkItems(events).items.get(terminalId);
    expect(item).toMatchObject({
      id: terminalId,
      kind: "bash",
      status: "completed",
      output: ["terminal output"],
      result: { exit_code: 0, signal: null },
      missing_start: undefined,
    });
  });

  it("records a user Stop as killed instead of successful completion", async () => {
    const events = captureCanonicalEvents();
    const { terminalId } = createTerminal("sess-terminal", process.cwd(), {
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    });
    terminalIds.add(terminalId);

    killTerminal({ terminalId });
    await waitForTerminalExit({ terminalId });

    const item = reduceWorkItems(events).items.get(terminalId);
    expect(item).toMatchObject({
      id: terminalId,
      kind: "bash",
      status: "killed",
      reason: "user_kill",
      result: { exit_code: null, signal: "SIGTERM" },
    });
  });
});
