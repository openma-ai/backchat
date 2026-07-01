import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const childProcess = vi.hoisted(() => ({ spawnSync: vi.fn() }));

vi.mock("node:child_process", () => childProcess);

import { _resetRegistryCache, detect, loadRegistry, registryShimName } from "./registry";

describe("detect", () => {
  beforeEach(() => {
    _resetRegistryCache();
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

  it("maps official npx adapters to managed registry shims", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: 1,
            agents: [
              {
                id: "sample-agent",
                name: "Sample Agent",
                version: "0.45.0",
                distribution: {
                  npx: {
                    package: "@agentclientprotocol/sample-agent@0.45.0",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const binDir = join(tmpdir(), `backchat-registry-detect-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const shim = join(binDir, registryShimName("sample-agent"));
    await writeFile(shim, "#!/usr/bin/env node\n", { mode: 0o755 });

    const registry = await loadRegistry({ forceRefresh: true });
    expect(registry.find((agent) => agent.id === "sample-agent")).toMatchObject({
      id: "sample-agent",
      spec: { command: registryShimName("sample-agent") },
      install: { kind: "npm", package: "@agentclientprotocol/sample-agent" },
      installSource: "registry",
    });

    expect(
      await detect("sample-agent", {
        env: { PATH: "/usr/bin:/bin", OPENMA_ACP_BIN_DIR: binDir },
        systemPathFallbackDirs: [],
      }),
    ).toMatchObject({
      id: "sample-agent",
      spec: { command: shim },
    });
  });
});
