import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetRegistryCache, loadRegistry } from "./registry";

describe("loadRegistry", () => {
  beforeEach(() => {
    _resetRegistryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetRegistryCache();
  });

  it("keeps official adapter launch specs when overlay metadata exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: 1,
            agents: [
              {
                id: "claude-acp",
                name: "Claude Agent",
                version: "0.45.0",
                repository: "https://github.com/agentclientprotocol/claude-agent-acp",
                website: "https://agentclientprotocol.com",
                distribution: {
                  npx: {
                    package: "@agentclientprotocol/claude-agent-acp@0.45.0",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const agents = await loadRegistry({ forceRefresh: true });
    const claude = agents.find((a) => a.id === "claude-acp");

    expect(claude?.spec.command).toBe("npx");
    expect(claude?.spec.args).toEqual([
      "-y",
      "@agentclientprotocol/claude-agent-acp@0.45.0",
    ]);
    expect(claude?.version).toBe("0.45.0");
    expect(claude?.install).toEqual({
      kind: "npm",
      package: "@agentclientprotocol/claude-agent-acp",
    });
    expect(claude?.featured).toBe(true);
    expect(claude?.wraps).toBe("claude");
  });
});
