import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { elicitationCallbackForSession } from "./acp-client-callback-adapters.js";
import type { ElicitationFormRequestInfo } from "../shared/api.js";

const dshFixture = JSON.parse(readFileSync(
  new URL("./__fixtures__/dsh-user-questions-elicitation.json", import.meta.url),
  "utf8",
)) as {
  requests: { multi: Record<string, unknown> };
  cases: Array<{
    name: string;
    content: Record<string, string | string[]>;
  }>;
};

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

  it("broadcasts dsh questions and accepts a custom-only multiselect answer", async () => {
    let form: ElicitationFormRequestInfo | undefined;
    const callback = elicitationCallbackForSession({
      sessionId: "sess-dsh",
      requestForm: async (request: ElicitationFormRequestInfo) => {
        form = request;
        return { action: "decline" as const };
      },
    } as never);
    if (!callback) throw new Error("form callback was not registered");
    await callback(dshFixture.requests.multi as never);
    if (!form?.questions) throw new Error("dsh questions were not normalized");

    const customOnly = dshFixture.cases.find((item) =>
      item.name === "custom-only-multiselect")!;
    const response = brokers.requestElicitationForm("sess-dsh", form);
    const pending = handlers.get(InvokeChannel.BrokerPendingAsks)?.({}) as Array<{
      kind: string;
      ask: {
        requestId: string;
        sessionId: string;
        fields: ElicitationFormRequestInfo["fields"];
        questions?: ElicitationFormRequestInfo["questions"];
      };
    }>;
    const dshAsk = pending.find((item) => item.ask.sessionId === "sess-dsh")!;
    expect(dshAsk).toMatchObject({
      kind: "elicitation",
      ask: {
        sessionId: "sess-dsh",
        fields: form.fields,
        questions: form.questions,
      },
    });

    handlers.get(InvokeChannel.ElicitationRespond)?.({}, {
      requestId: dshAsk.ask.requestId,
      action: "accept",
      content: customOnly.content,
    });

    await expect(response).resolves.toEqual({
      action: "accept",
      content: customOnly.content,
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
