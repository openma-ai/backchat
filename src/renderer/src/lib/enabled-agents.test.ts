import { describe, expect, it } from "vitest";
import type { Settings } from "@shared/settings";
import { enabledAgentIds, isAgentEnabled, isAgentRunnable } from "./enabled-agents";

const baseSettings: Settings = {
  default: {
    workspace_path: "",
    permission_mode: "ask",
    prompt_queue_enabled: true,
  },
  appearance: {
    light_theme_id: "backchat-light",
    dark_theme_id: "backchat-dark",
    theme: "system",
    language: "system",
    font_size: "md",
    density: "default",
  },
  agents: [],
  mcp_servers: [],
};

describe("enabled ACP agents", () => {
  it("only treats explicitly enabled agents as enabled", () => {
    const settings: Settings = {
      ...baseSettings,
      agents: [
        { id: "claude-acp", enabled: true, env: [] },
        { id: "gemini", env: [] },
      ],
    };

    expect([...enabledAgentIds(settings)].sort()).toEqual(["claude-acp"]);
    expect(isAgentEnabled(settings, "claude-acp")).toBe(true);
    expect(isAgentEnabled(settings, "codex-acp")).toBe(false);
    expect(isAgentEnabled(settings, "gemini")).toBe(false);
  });

  it("requires an enabled agent to also be runnable before composer can show it", () => {
    expect(isAgentRunnable({ detected: true })).toBe(true);
    expect(isAgentRunnable({ available: true })).toBe(true);
    expect(isAgentRunnable({ installed: true })).toBe(true);
    expect(isAgentRunnable({ installable: true } as never)).toBe(false);
    expect(isAgentRunnable({ detected: false, installed: false })).toBe(false);
  });
});
