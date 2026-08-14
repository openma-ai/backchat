import { describe, expect, it } from "vitest";

import {
  AGENT_SKILL_DIRECTORIES,
  skillDirectoryForAgent,
} from "./agent-skill-directories.js";

describe("agent skill directories", () => {
  it("tracks every project-scope registry directory exposed by skills", () => {
    expect(Object.keys(AGENT_SKILL_DIRECTORIES).length).toBeGreaterThanOrEqual(75);
    expect(AGENT_SKILL_DIRECTORIES).toMatchObject({
      "claude-code": ".claude/skills",
      codex: ".agents/skills",
      "gemini-cli": ".agents/skills",
      openclaw: "skills",
      opencode: ".agents/skills",
      cursor: ".agents/skills",
      "qwen-code": ".qwen/skills",
    });
  });

  it.each([
    ["claude-acp", ".claude/skills"],
    ["claude-agent-acp", ".claude/skills"],
    ["codex-acp", ".agents/skills"],
    ["codex-acp-bridge", ".agents/skills"],
    ["gemini", ".agents/skills"],
    ["github-copilot-cli", ".agents/skills"],
    ["hermes", ".hermes/skills"],
  ])("maps ACP registry id %s to %s", (agentId, expected) => {
    expect(skillDirectoryForAgent(agentId)).toBe(expected);
  });

  it("falls back to the universal project skill directory", () => {
    expect(skillDirectoryForAgent("future-acp-agent")).toBe(".agents/skills");
  });
});
