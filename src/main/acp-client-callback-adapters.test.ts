import { describe, expect, it, vi } from "vitest";

import { elicitationCallbackForSession } from "./acp-client-callback-adapters.js";

describe("ACP elicitation adapter", () => {
  it("normalizes free-text and numeric fields for the existing elicitation ask slot", async () => {
    const requestForm = vi.fn(async () => ({
      action: "accept" as const,
      content: { note: "ship it", retries: 3, temperature: 0.25 },
    }));
    const callback = elicitationCallbackForSession({
      sessionId: "sess-form",
      requestForm,
    } as never);
    expect(callback).toBeTypeOf("function");
    if (!callback) return;

    await expect(callback({
      mode: "form",
      sessionId: "sess-form",
      message: "Configure release",
      requestedSchema: {
        type: "object",
        properties: {
          note: {
            type: "string",
            title: "Release note",
            description: "Shown to users",
            minLength: 3,
            maxLength: 120,
            default: "ship it",
          },
          retries: {
            type: "integer",
            title: "Retries",
            minimum: 0,
            maximum: 5,
            default: 2,
          },
          temperature: {
            type: "number",
            title: "Temperature",
            minimum: 0,
            maximum: 1,
          },
        },
        required: ["note", "retries"],
      },
    })).resolves.toEqual({
      action: "accept",
      content: { note: "ship it", retries: 3, temperature: 0.25 },
    });
    expect(requestForm).toHaveBeenCalledWith({
      sessionId: "sess-form",
      message: "Configure release",
      fields: [
        {
          name: "note",
          type: "text",
          title: "Release note",
          description: "Shown to users",
          required: true,
          minLength: 3,
          maxLength: 120,
          defaultValue: "ship it",
        },
        {
          name: "retries",
          type: "number",
          title: "Retries",
          required: true,
          integer: true,
          minimum: 0,
          maximum: 5,
          defaultValue: 2,
        },
        {
          name: "temperature",
          type: "number",
          title: "Temperature",
          required: false,
          integer: false,
          minimum: 0,
          maximum: 1,
        },
      ],
    });
  });

  it("routes URL mode to the existing elicitation ask slot with opaque completion identity", async () => {
    const requestUrl = vi.fn(async () => ({ action: "accept" as const }));
    const callback = elicitationCallbackForSession({
      sessionId: "sess-url",
      requestUrl,
    } as never);
    expect(callback).toBeTypeOf("function");
    if (!callback) return;

    await expect(callback({
      mode: "url",
      sessionId: "provider-session",
      elicitationId: "github-oauth-001",
      url: "https://agent.example.com/connect?elicitationId=github-oauth-001",
      message: "Authorize repository access",
    })).resolves.toEqual({ action: "accept" });
    expect(requestUrl).toHaveBeenCalledWith({
      sessionId: "sess-url",
      message: "Authorize repository access",
      elicitationId: "github-oauth-001",
      url: "https://agent.example.com/connect?elicitationId=github-oauth-001",
    });
  });

  it("declines URL elicitation schemes that must not reach the OS shell", async () => {
    const requestUrl = vi.fn(async () => ({ action: "accept" as const }));
    const callback = elicitationCallbackForSession({
      sessionId: "sess-unsafe-url",
      requestUrl,
    } as never);
    expect(callback).toBeTypeOf("function");
    if (!callback) return;

    await expect(callback({
      mode: "url",
      sessionId: "provider-session",
      elicitationId: "unsafe-001",
      url: "file:///etc/passwd",
      message: "Open local file",
    })).resolves.toEqual({ action: "decline" });
    expect(requestUrl).not.toHaveBeenCalled();
  });
});
