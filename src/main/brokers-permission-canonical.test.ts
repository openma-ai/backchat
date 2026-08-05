import { describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import {
  registerBrokers,
  requestPermission,
  setBrokerSessionEventSink,
} from "./brokers.js";
import { InvokeChannel } from "../shared/ipc-channels.js";

describe("permission broker canonical input lifecycle", () => {
  it("projects Codex permission metadata into a harness-neutral ask presentation", async () => {
    registerBrokers();
    const response = (requestPermission as unknown as (
      sessionId: string,
      params: unknown,
      agentId: string,
    ) => Promise<unknown>)("sess-codex-permission", {
      toolCall: {
        toolCallId: "tool-codex-1",
        kind: "execute",
        _meta: {
          codex: {
            params: {
              title: "Run project checks",
              reason: "The release gate requires a clean build.",
              command: "pnpm verify",
            },
          },
        },
      },
      options: [{ optionId: "allow-once", name: "Allow", kind: "allow_once" }],
    }, "codex-acp");

    const pendingHandler = handlers.get(InvokeChannel.BrokerPendingAsks);
    const pending = pendingHandler?.({}) as Array<{
      ask: {
        requestId: string;
        presentation?: Record<string, unknown>;
      };
    }>;
    const ask = pending.find((entry) =>
      entry.ask.presentation?.title === "Run project checks")?.ask;
    expect(ask?.presentation).toEqual({
      title: "Run project checks",
      reason: "The release gate requires a clean build.",
      command: "pnpm verify",
      kind: "execute",
    });

    const respond = handlers.get(InvokeChannel.PermissionRespond);
    respond?.({}, { requestId: ask?.requestId, optionId: "allow-once" });
    await expect(response).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
  });

  it("emits the user's permission decision through the session event sink", async () => {
    const sink = vi.fn();
    setBrokerSessionEventSink(sink);
    registerBrokers();
    const response = requestPermission("sess-permission", {
      toolCall: { toolCallId: "tool-1", title: "Run command" },
      options: [{ optionId: "allow-once", name: "Allow", kind: "allow_once" }],
    });

    const respond = handlers.get(InvokeChannel.PermissionRespond);
    expect(respond).toBeTypeOf("function");
    respond?.({}, { requestId: expect.any(String), optionId: "allow-once" });

    // Resolve through the actual pending request id exposed by the broker.
    const pendingHandler = handlers.get(InvokeChannel.BrokerPendingAsks);
    const pending = pendingHandler?.({}) as Array<{
      ask: { requestId: string };
    }>;
    const requestId = pending?.[0]?.ask.requestId;
    expect(requestId).toBeTruthy();
    respond?.({}, { requestId, optionId: "allow-once" });

    await expect(response).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
    expect(sink).toHaveBeenCalledWith({
      type: "session.permission_response",
      session_id: "sess-permission",
      request_id: requestId,
      option_id: "allow-once",
      outcome: "selected",
    });
  });
});
