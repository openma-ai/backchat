import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => childProcess);

import { _resetRegistryCache, detect, loadRegistry } from "./registry";

describe("detect", () => {
  beforeEach(() => {
    _resetRegistryCache();
    childProcess.spawn.mockImplementation(() => ({
      once(event: string, cb: (code?: number) => void) {
        if (event === "exit") queueMicrotask(() => cb(0));
        return this;
      },
    }));
    childProcess.spawnSync.mockReturnValue({
      status: 0,
      stdout: "/opt/homebrew/lib/node_modules/some-other-package\n",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    _resetRegistryCache();
  });

  it("treats official npx -y adapters as detected without global npm install", async () => {
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

    await loadRegistry({ forceRefresh: true });

    expect(await detect("claude-acp")).toMatchObject({
      id: "claude-acp",
      spec: {
        command: "npx",
        args: ["-y", "@agentclientprotocol/claude-agent-acp@0.45.0"],
      },
    });
  });
});
