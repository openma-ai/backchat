import { expect, test } from "vitest";

// Exercise the installed, pnpm-patched SDK compatibility boundary itself.
const sdkClientUrl = new URL("../../../node_modules/@openma/common/dist/acp-runtime/sdk-client.js", import.meta.url).href;

test.each([1, 3])("coalesced prompt reply cannot overtake %i preceding session notifications", async (count) => {
  const { sdkClient } = await import(/* @vite-ignore */ sdkClientUrl);
  let incoming!: ReadableStreamDefaultController;
  const observed: string[] = [];
  const stream = {
    readable: new ReadableStream({ start(controller) { incoming = controller; } }),
    writable: new WritableStream({ write(request) {
      for (let index = 0; index < count; index++) incoming.enqueue({ jsonrpc: "2.0", method: "session/update", params: {
        sessionId: "root", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } },
      } });
      incoming.enqueue({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn" } });
    } }),
  };
  const client = sdkClient({ sessionUpdate: async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    observed.push("answer");
  } }, stream);
  try {
    await client.prompt({ sessionId: "root", prompt: [{ type: "text", text: "go" }] });
    observed.push("complete");
    expect(observed).toEqual([...Array(count).fill("answer"), "complete"]);
  } finally {
    incoming.close();
  }
});


test("notification ordering does not hold back permission requests", async () => {
  const { sdkClient } = await import(/* @vite-ignore */ sdkClientUrl);
  let incoming!: ReadableStreamDefaultController;
  let promptId: unknown;
  let released!: () => void;
  const permission = new Promise<void>((resolve) => { released = resolve; });
  const stream = {
    readable: new ReadableStream({ start(controller) { incoming = controller; } }),
    writable: new WritableStream({ write(message) {
      if (message.method === "session/prompt") {
        promptId = message.id;
        incoming.enqueue({ jsonrpc: "2.0", method: "session/update", params: {
          sessionId: "root", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } },
        } });
        incoming.enqueue({ jsonrpc: "2.0", id: "permission", method: "session/request_permission", params: {
          sessionId: "root", toolCall: { toolCallId: "read" }, options: [],
        } });
      } else if (message.id === "permission") {
        released();
        incoming.enqueue({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
      }
    } }),
  };
  const client = sdkClient({
    sessionUpdate: async () => { await permission; },
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  }, stream);
  try {
    expect(await client.prompt({ sessionId: "root", prompt: [{ type: "text", text: "go" }] })).toEqual({ stopReason: "end_turn" });
  } finally { incoming.close(); }
});
