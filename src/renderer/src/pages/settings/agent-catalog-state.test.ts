import { describe, expect, it } from "vitest";

import type { AgentInfo } from "@shared/api";
import {
  filterAgentCatalog,
  prioritizeAgentCatalog,
} from "./agent-catalog-state";

function agent(id: string, label: string, command = id): AgentInfo {
  return { id, label, command, detected: false };
}

describe("Agent catalog state", () => {
  it("pins DeepSeek Harness above every other agent without disturbing its peers", () => {
    const agents = [
      agent("codex-acp", "Codex"),
      agent("dsh-acp", "DeepSeek Harness"),
      agent("claude-acp", "Claude"),
    ];

    expect(prioritizeAgentCatalog(agents, "dsh-acp")).toEqual([
      agents[1],
      agents[0],
      agents[2],
    ]);
  });

  it("searches agent names, ids, commands, and install hints case-insensitively", () => {
    const agents = [
      {
        ...agent("dsh-acp", "DeepSeek Harness"),
        installHint: "npm install -g @openma/deepseek-harness-acp",
      },
      agent("codex-acp", "Codex", "/usr/local/bin/codex-acp"),
    ];

    expect(filterAgentCatalog(agents, "  DEEPSEEK  ")).toEqual([agents[0]]);
    expect(filterAgentCatalog(agents, "openma")).toEqual([agents[0]]);
    expect(filterAgentCatalog(agents, "local/bin/codex")).toEqual([agents[1]]);
    expect(filterAgentCatalog(agents, "")).toEqual(agents);
  });
});
