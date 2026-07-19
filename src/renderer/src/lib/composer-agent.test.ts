import { describe, expect, it } from "vitest";
import { isComposerAgentLocked, resolveComposerAgentId } from "./composer-agent";

describe("composer agent selection", () => {
  it("uses the bound session agent before the global default", () => {
    expect(
      resolveComposerAgentId({
        sessionAgentId: "codex-acp",
        defaultAgentId: "gemini",
      }),
    ).toBe("codex-acp");
  });

  it("falls back to the global default for new chats", () => {
    expect(
      resolveComposerAgentId({
        sessionAgentId: "",
        defaultAgentId: "gemini",
      }),
    ).toBe("gemini");
  });

  it("locks the picker only when a session agent is bound", () => {
    expect(isComposerAgentLocked("codex-acp")).toBe(true);
    expect(isComposerAgentLocked("")).toBe(false);
  });

});
