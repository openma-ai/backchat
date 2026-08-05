import { describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const send = vi.fn();
const openExternal = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }],
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  shell: { openExternal },
}));

import * as brokers from "./brokers.js";
import { InvokeChannel } from "../shared/ipc-channels.js";

describe("ACP elicitation form broker", () => {
  it("round-trips typed form content and emits a canonical user-input fact", async () => {
    const requestForm = (
      brokers as unknown as {
        requestElicitationForm?: typeof import("./brokers.js")["requestPermission"];
      }
    ).requestElicitationForm;
    expect(requestForm).toBeTypeOf("function");
    if (!requestForm) return;

    const sink = vi.fn();
    brokers.setBrokerSessionEventSink(sink);
    brokers.registerBrokers();
    const response = requestForm("sess-form", {
      sessionId: "sess-form",
      message: "Configure release",
      fields: [
        {
          name: "note",
          type: "text",
          title: "Release note",
          required: true,
          minLength: 3,
        },
        {
          name: "retries",
          type: "number",
          title: "Retries",
          required: true,
          integer: true,
          minimum: 0,
          maximum: 5,
        },
      ],
    });

    const pending = handlers.get(InvokeChannel.BrokerPendingAsks)?.({}) as Array<{
      kind: string;
      ask: { requestId: string };
    }>;
    expect(pending).toMatchObject([{
      kind: "elicitation",
      ask: {
        sessionId: "sess-form",
        message: "Configure release",
      },
    }]);
    const requestId = pending[0]!.ask.requestId;
    handlers.get("elicitation:respond")?.({}, {
      requestId,
      action: "accept",
      content: { note: "ship it", retries: 3 },
    });

    await expect(response).resolves.toEqual({
      action: "accept",
      content: { note: "ship it", retries: 3 },
    });
    expect(send).toHaveBeenCalledWith(
      "elicitation:request",
      expect.objectContaining({ requestId, sessionId: "sess-form" }),
    );
    expect(sink).toHaveBeenCalledWith({
      type: "session.elicitation_response",
      session_id: "sess-form",
      request_id: requestId,
      action: "accept",
      content: { note: "ship it", retries: 3 },
    });
  });

  it("declines an accepted form whose numeric value violates the schema", async () => {
    const response = brokers.requestElicitationForm("sess-invalid-number", {
      sessionId: "sess-invalid-number",
      message: "Configure retries",
      fields: [{
        name: "retries",
        type: "number",
        title: "Retries",
        required: true,
        integer: true,
        minimum: 0,
        maximum: 5,
      }],
    });
    const pending = handlers.get(InvokeChannel.BrokerPendingAsks)?.({}) as Array<{
      kind: string;
      ask: { requestId: string; sessionId: string };
    }>;
    const requestId = pending.find((item) =>
      item.ask.sessionId === "sess-invalid-number")!.ask.requestId;

    handlers.get(InvokeChannel.ElicitationRespond)?.({}, {
      requestId,
      action: "accept",
      content: { retries: 6 },
    });

    await expect(response).resolves.toEqual({ action: "decline" });
  });

  it("declines an accepted form that omits a required field", async () => {
    const response = brokers.requestElicitationForm("sess-missing-required", {
      sessionId: "sess-missing-required",
      message: "Configure release",
      fields: [{
        name: "note",
        type: "text",
        title: "Release note",
        required: true,
      }],
    });
    const pending = handlers.get(InvokeChannel.BrokerPendingAsks)?.({}) as Array<{
      kind: string;
      ask: { requestId: string; sessionId: string };
    }>;
    const requestId = pending.find((item) =>
      item.ask.sessionId === "sess-missing-required")!.ask.requestId;

    handlers.get(InvokeChannel.ElicitationRespond)?.({}, {
      requestId,
      action: "accept",
      content: {},
    });

    await expect(response).resolves.toEqual({ action: "decline" });
  });

  it("opens an accepted URL elicitation externally and records the typed user decision", async () => {
    const urlSink = vi.fn();
    brokers.setBrokerSessionEventSink(urlSink);
    brokers.registerBrokers();
    const response = brokers.requestElicitationUrl("sess-url", {
      sessionId: "sess-url",
      message: "Authorize repository access",
      elicitationId: "github-oauth-001",
      url: "https://agent.example.com/connect?elicitationId=github-oauth-001",
    });
    const pending = handlers.get(InvokeChannel.BrokerPendingAsks)?.({}) as Array<{
      kind: string;
      ask: { requestId: string; sessionId: string; mode?: string };
    }>;
    expect(pending).toMatchObject([{
      kind: "elicitation",
      ask: {
        sessionId: "sess-url",
        mode: "url",
        message: "Authorize repository access",
        elicitationId: "github-oauth-001",
        url: "https://agent.example.com/connect?elicitationId=github-oauth-001",
      },
    }]);
    const requestId = pending[0]!.ask.requestId;

    await handlers.get(InvokeChannel.ElicitationRespond)?.({}, {
      requestId,
      action: "accept",
    });

    await expect(response).resolves.toEqual({ action: "accept" });
    expect(openExternal).toHaveBeenCalledWith(
      "https://agent.example.com/connect?elicitationId=github-oauth-001",
    );
    expect(urlSink).toHaveBeenLastCalledWith({
      type: "session.elicitation_response",
      session_id: "sess-url",
      request_id: requestId,
      action: "accept",
      mode: "url",
      elicitation_id: "github-oauth-001",
    });
  });
});
