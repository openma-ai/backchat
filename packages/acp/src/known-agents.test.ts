import { describe, expect, it } from "vitest";
import { OVERLAY_AGENTS } from "./known-agents.js";

describe("known agent metadata", () => {
  it("does not fabricate Codex models before a live probe", () => {
    const codex = OVERLAY_AGENTS.find((agent) => agent.id === "codex-acp");

    expect(codex?.configOptions).toBeUndefined();
  });

  it("enables Cursor as cursor-agent acp when the managed shim is absent", () => {
    const cursor = OVERLAY_AGENTS.find((agent) => agent.id === "cursor");
    expect(cursor).toMatchObject({
      id: "cursor",
      systemCommand: "cursor-agent",
      systemPath: true,
      spec: { args: ["acp"] },
    });
  });
});
