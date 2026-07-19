import { describe, expect, it } from "vitest";
import { harnessDisplayName } from "./harness-display";

describe("harnessDisplayName", () => {
  it("uses product names for known ACP harness adapters", () => {
    expect(harnessDisplayName("codex-acp")).toBe("Codex");
    expect(harnessDisplayName("claude-acp")).toBe("Claude");
  });

  it("removes an ACP transport suffix from custom harness ids", () => {
    expect(harnessDisplayName("team-agent-acp")).toBe("team-agent");
  });

  it("preserves known brand casing for non-suffixed harnesses", () => {
    expect(harnessDisplayName("gemini")).toBe("Gemini CLI");
    expect(harnessDisplayName("opencode")).toBe("OpenCode");
  });
});
