import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { elicitationCallbackForSession } from "./acp-client-callback-adapters.js";
import type { ElicitationFormRequestInfo } from "../shared/api.js";

type FixtureQuestion = {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  intent?: { kind: string; approve: string };
};

type FixtureRequest = {
  mode: "form";
  sessionId: string;
  message: string;
  requestedSchema: {
    type: string;
    properties: Record<string, Record<string, unknown>>;
    required: string[];
  };
  _meta?: Record<string, unknown>;
};

type FixtureMeta = {
  version: number;
  questions: FixtureQuestion[];
};

const dshFixture = JSON.parse(readFileSync(
  new URL("./__fixtures__/dsh-user-questions-elicitation.json", import.meta.url),
  "utf8",
)) as {
  requests: { multi: FixtureRequest; planReview: FixtureRequest };
};

function dshMeta(request: FixtureRequest): FixtureMeta {
  return request._meta?.["dsh.userQuestions"] as FixtureMeta;
}

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

  it("normalizes real dsh multi-question metadata against its form schema", async () => {
    const requestForm = vi.fn(async (_request: ElicitationFormRequestInfo) => ({
      action: "decline" as const,
    }));
    const callback = elicitationCallbackForSession({
      sessionId: "sess-dsh",
      requestForm,
    } as never);
    if (!callback) throw new Error("form callback was not registered");

    await callback(dshFixture.requests.multi as never);

    expect(requestForm.mock.calls[0]?.[0].fields).toEqual([
      {
        name: "question_0",
        type: "select",
        title: "Target",
        description: "Where should this run?\n\nChoose the deployment target.",
        required: false,
        options: [
          { value: "option_0", label: "Local", description: "Run on this machine." },
          {
            value: "option_1",
            label: "Staging",
            description: "Deploy to the shared staging cluster.",
          },
          { value: "custom_0", label: "Other" },
        ],
      },
      {
        name: "question_0_custom",
        type: "text",
        title: "Other",
        description: "Type a custom answer.",
        required: false,
      },
      {
        name: "question_1",
        type: "multiselect",
        title: "Checks",
        description: "Which checks should run first?",
        required: false,
        options: [
          { value: "option_0", label: "Lint" },
          { value: "option_1", label: "Typecheck" },
          { value: "option_2", label: "Unit tests" },
          { value: "custom_1", label: "Other" },
        ],
        minItems: 1,
      },
      {
        name: "question_1_custom",
        type: "text",
        title: "Other",
        description: "Type a custom answer.",
        required: false,
      },
      {
        name: "question_2",
        type: "text",
        title: "Anything else the agent should know?",
        required: false,
      },
    ]);
    expect(requestForm.mock.calls[0]?.[0].questions).toEqual([
      {
        id: "target",
        question: "Where should this run?",
        header: "Target",
        detail: "Choose the deployment target.",
        multiSelect: false,
        field: "question_0",
        customField: "question_0_custom",
        options: [
          {
            value: "option_0",
            label: "Local",
            description: "Run on this machine.",
          },
          {
            value: "option_1",
            label: "Staging",
            description: "Deploy to the shared staging cluster.",
          },
        ],
      },
      {
        id: "checks",
        question: "Which checks should run first?",
        header: "Checks",
        multiSelect: true,
        field: "question_1",
        customField: "question_1_custom",
        options: [
          { value: "option_0", label: "Lint" },
          { value: "option_1", label: "Typecheck" },
          { value: "option_2", label: "Unit tests" },
        ],
      },
      {
        id: "notes",
        question: "Anything else the agent should know?",
        multiSelect: false,
        field: "question_2",
        options: [],
      },
    ]);
  });

  it("keeps a validated dsh plan-review intent", async () => {
    const requestForm = vi.fn(async (_request: ElicitationFormRequestInfo) => ({
      action: "decline" as const,
    }));
    const callback = elicitationCallbackForSession({
      sessionId: "sess-dsh",
      requestForm,
    } as never);
    if (!callback) throw new Error("form callback was not registered");

    await callback(dshFixture.requests.planReview as never);

    expect(requestForm.mock.calls[0]?.[0].questions).toMatchObject([{
      id: "plan-review",
      intent: { kind: "plan-review", approve: "Approve" },
    }]);
  });

  it.each([
    ["version 2", (request: FixtureRequest) => {
      dshMeta(request).version = 2;
    }],
    ["missing metadata", (request: FixtureRequest) => {
      delete request._meta;
    }],
    ["a metadata label mismatch", (request: FixtureRequest) => {
      dshMeta(request).questions[0]!.options![0]!.label = "Not Local";
    }],
    ["an unclaimed schema field", (request: FixtureRequest) => {
      request.requestedSchema.properties.orphan = { type: "string" };
    }],
    ["a field with the wrong type", (request: FixtureRequest) => {
      const field = request.requestedSchema.properties.question_0!;
      field.type = "array";
      field.items = { anyOf: field.oneOf };
      delete field.oneOf;
    }],
  ])("falls back to the generic form for %s", async (_name, mutate) => {
    const request = structuredClone(dshFixture.requests.multi);
    mutate(request);
    const requestForm = vi.fn(async (_request: ElicitationFormRequestInfo) => ({
      action: "decline" as const,
    }));
    const callback = elicitationCallbackForSession({
      sessionId: "sess-dsh",
      requestForm,
    } as never);
    if (!callback) throw new Error("form callback was not registered");

    await callback(request as never);

    const normalized = requestForm.mock.calls[0]?.[0];
    expect(normalized?.fields.length).toBeGreaterThan(0);
    expect(normalized).not.toHaveProperty("questions");
  });

  it("drops an unknown intent while preserving its question", async () => {
    const request = structuredClone(dshFixture.requests.planReview);
    dshMeta(request).questions[0]!.intent!.kind = "future-intent";
    const requestForm = vi.fn(async (_request: ElicitationFormRequestInfo) => ({
      action: "decline" as const,
    }));
    const callback = elicitationCallbackForSession({
      sessionId: "sess-dsh",
      requestForm,
    } as never);
    if (!callback) throw new Error("form callback was not registered");

    await callback(request as never);

    expect(requestForm.mock.calls[0]?.[0].questions).toMatchObject([{
      id: "plan-review",
    }]);
    expect(requestForm.mock.calls[0]?.[0].questions?.[0]).not.toHaveProperty("intent");
  });
});
