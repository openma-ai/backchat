import { describe, expect, it } from "vitest";

import type { AgentInfo } from "@shared/api.js";
import type { Settings } from "@shared/settings.js";
import { deriveComposerHarnessState } from "./composer-harness-state";

const settings: Settings = {
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
  agents: [
    { id: "codex-acp", enabled: true, env: [] },
    { id: "claude-acp", enabled: true, env: [] },
    { id: "gemini", enabled: true, env: [] },
  ],
  mcp_servers: [],
};

function agent(
  id: string,
  detected: boolean,
): AgentInfo {
  return {
    id,
    label: id,
    command: id,
    detected,
  };
}

const agents = [
  agent("codex-acp", true),
  agent("claude-acp", false),
  agent("gemini", true),
  agent("disabled-agent", true),
];

describe("composer harness state", () => {
  it("only exposes agents that are both enabled and runnable", () => {
    const state = deriveComposerHarnessState({
      agents,
      settings,
      recentAgentId: "codex-acp",
    });

    expect(state.enabledAgents.map(({ id }) => id)).toEqual([
      "codex-acp",
      "gemini",
    ]);
    expect(state.currentAgentId).toBe("codex-acp");
    expect(state.currentEnabledAgent?.id).toBe("codex-acp");
    expect(state.hasHarnessSetup).toBe(true);
  });

  it("resolves the current agent in lock, pick, session, recent, fallback order", () => {
    const base = {
      agents,
      settings,
    };

    expect(deriveComposerHarnessState({
      ...base,
      lockedAgentId: "locked",
      pickedAgentId: "picked",
      sessionAgentId: "session",
      recentAgentId: "codex-acp",
    }).currentAgentId).toBe("locked");
    expect(deriveComposerHarnessState({
      ...base,
      pickedAgentId: "picked",
      sessionAgentId: "session",
      recentAgentId: "codex-acp",
    }).currentAgentId).toBe("picked");
    expect(deriveComposerHarnessState({
      ...base,
      sessionAgentId: "session",
      recentAgentId: "codex-acp",
    }).currentAgentId).toBe("session");
    expect(deriveComposerHarnessState({
      ...base,
      recentAgentId: "codex-acp",
    }).currentAgentId).toBe("codex-acp");
    expect(deriveComposerHarnessState({
      ...base,
      recentAgentId: "claude-acp",
    }).currentAgentId).toBe("codex-acp");
  });

  it("falls back to the first enabled runnable agent", () => {
    expect(deriveComposerHarnessState({
      agents,
      settings,
    }).currentAgentId).toBe("codex-acp");
  });

  it("accepts externally managed and locked harnesses without a local runnable agent", () => {
    const noLocalHarness = {
      agents: [],
      settings,
    };

    expect(deriveComposerHarnessState({
      ...noLocalHarness,
      agentPickerLabel: "Pair agents",
    }).hasHarnessSetup).toBe(true);
    expect(deriveComposerHarnessState({
      ...noLocalHarness,
      lockedAgentId: "remote-agent",
    }).hasHarnessSetup).toBe(true);
    expect(deriveComposerHarnessState(noLocalHarness).hasHarnessSetup).toBe(false);
  });
});
