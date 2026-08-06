import { access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  shell: { openExternal: vi.fn() },
}));

import {
  registerBrokers,
  setBrokerSessionEventSink,
  writeTextFile,
} from "./brokers.js";
import { InvokeChannel } from "../shared/ipc-channels.js";

describe("filesystem broker decision lifecycle", () => {
  it("emits a durable denied decision and does not write the requested file", async () => {
    const sink = vi.fn();
    setBrokerSessionEventSink(sink);
    registerBrokers();
    const target = join(
      tmpdir(),
      `backchat-denied-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    const response = writeTextFile("sess-filesystem", "/workspace/project", {
      path: target,
      content: "must not be written",
    });

    let pending: Array<{
      kind: string;
      ask: { requestId: string; path: string };
    }> = [];
    await vi.waitFor(() => {
      pending = handlers.get(InvokeChannel.BrokerPendingAsks)?.({}) as typeof pending;
      expect(pending.some((item) => item.kind === "fsWrite")).toBe(true);
    });
    const request = pending.find((item) => item.kind === "fsWrite")!;
    expect(request.ask.path).toBe(target);

    await handlers.get(InvokeChannel.FsApprovalRespond)?.({}, {
      requestId: request.ask.requestId,
      approved: false,
    });

    await expect(response).rejects.toThrow("user denied write");
    await expect(access(target)).rejects.toThrow();
    expect(sink).toHaveBeenCalledWith({
      type: "session.fs_write_response",
      session_id: "sess-filesystem",
      request_id: request.ask.requestId,
      path: target,
      outcome: "denied",
    });
  });
});
