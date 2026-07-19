import { describe, expect, it } from "vitest";
import { OVERLAY_AGENTS } from "./known-agents.js";

describe("known agent metadata", () => {
  it("does not fabricate Codex models before a live probe", () => {
    const codex = OVERLAY_AGENTS.find((agent) => agent.id === "codex-acp");

    expect(codex?.configOptions).toBeUndefined();
  });
});
