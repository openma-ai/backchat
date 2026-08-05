import { describe, expect, it } from "vitest";

import { composePromptContext } from "./session-prompt-context.js";

describe("session prompt context", () => {
  it("serializes referenced sessions as explicit tool-backed context", () => {
    const prompt = composePromptContext({
      text: "Compare these decisions",
      sessionReferences: [
        { session_id: "session-design", title: "Design review" },
        { session_id: "session-api", title: "API migration" },
      ],
    });

    expect(prompt).toContain("# Referenced sessions:");
    expect(prompt).toContain("openma_sessions_read");
    expect(prompt).toContain('"session_id":"session-design"');
    expect(prompt).toContain("Compare these decisions");
  });

  it("keeps ordinary prompts unchanged when no session is referenced", () => {
    expect(composePromptContext({ text: "Just answer this" })).toBe(
      "Just answer this",
    );
  });
});
