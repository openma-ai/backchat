import { describe, expect, it } from "vitest";

import { extensionRequestHandlerForHarness } from "./acp-extension-adapters";

describe("per-harness ACP extension request adapters", () => {
  it("acknowledges Cursor's non-blocking lifecycle projection requests", async () => {
    const handler = extensionRequestHandlerForHarness({
      agentId: "cursor",
      sessionId: "sess-cursor",
    });

    expect(handler).toBeTypeOf("function");
    await expect(handler?.("cursor/task", { toolCallId: "task-1" }))
      .resolves.toEqual({});
    await expect(handler?.("cursor/update_todos", { toolCallId: "todos-1" }))
      .resolves.toEqual({});
    await expect(handler?.("cursor/generate_image", { toolCallId: "image-1" }))
      .resolves.toEqual({});
  });

  it("answers Cursor single- and multi-select questions through the existing permission broker", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const selections = ["red", "blue", "__cursor_done__", "large"];
    const handler = extensionRequestHandlerForHarness({
      agentId: "cursor",
      sessionId: "sess-cursor",
      requestPermission: async (request) => {
        requests.push(request as unknown as Record<string, unknown>);
        return {
          outcome: {
            outcome: "selected",
            optionId: selections[requests.length - 1]!,
          },
        };
      },
    });

    const response = await handler?.("cursor/ask_question", {
      toolCallId: "ask-1",
      title: "Choose release settings",
      questions: [
        {
          id: "colors",
          prompt: "Choose colors",
          options: [
            { id: "red", label: "Red" },
            { id: "blue", label: "Blue" },
            { id: "green", label: "Green" },
          ],
          allowMultiple: true,
        },
        {
          id: "size",
          prompt: "Choose size",
          options: [
            { id: "small", label: "Small" },
            { id: "large", label: "Large" },
          ],
          allowMultiple: false,
        },
      ],
    });

    expect(response).toEqual({
      outcome: {
        outcome: "answered",
        answers: [
          { questionId: "colors", selectedOptionIds: ["red", "blue"] },
          { questionId: "size", selectedOptionIds: ["large"] },
        ],
      },
    });
    expect(requests).toHaveLength(4);
    expect(requests[0]).toMatchObject({
      sessionId: "sess-cursor",
      toolCall: { title: "Choose release settings: Choose colors" },
    });
  });

  it("accepts a Cursor plan through the existing permission broker", async () => {
    const handler = extensionRequestHandlerForHarness({
      agentId: "cursor",
      sessionId: "sess-cursor",
      requestPermission: async () => ({
        outcome: { outcome: "selected", optionId: "accept" },
      }),
    });

    await expect(handler?.("cursor/create_plan", {
      toolCallId: "plan-1",
      name: "Release",
      overview: "Ship safely",
      plan: "# Release\n\nShip safely",
      todos: [{ id: "todo-1", content: "Run tests", status: "pending" }],
    })).resolves.toEqual({ outcome: { outcome: "accepted" } });
  });

  it("leaves extension handling absent for non-Cursor harnesses", () => {
    expect(extensionRequestHandlerForHarness({
      agentId: "claude-acp",
      sessionId: "sess-claude",
    })).toBeUndefined();
  });
});
