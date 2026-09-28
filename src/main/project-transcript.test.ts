import { expect, it } from "vitest";
import { projectResponseText } from "../shared/project-transcript.js";
it("replaces streamed chunks with their final message without repeating the answer", () => {
  expect(
    projectResponseText([
      {
        type: "agent.message_chunk",
        data: { message_id: "m", text: "Hello " },
      },
      { type: "agent.message_chunk", data: { message_id: "m", text: "world" } },
      { type: "agent.message", data: { message_id: "m", text: "Hello world" } },
      { type: "agent.message", data: { message_id: "n", text: "Next" } },
    ]),
  ).toBe("Hello world\n\nNext");
});
