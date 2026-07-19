import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetRegistryCache, detect, getKnownAgents, loadRegistry } from "./registry.js";

describe("ACP agent setup registry", () => {
  beforeEach(() => {
    _resetRegistryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetRegistryCache();
  });

  it("keeps official registry metadata while preserving Backchat launch specs", async () => {
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
                icon: "https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg",
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
    const claude = agents.find((agent) => agent.id === "claude-acp");

    expect(claude?.spec.command).toBe("claude-agent-acp");
    expect(claude?.version).toBe("0.45.0");
    expect(claude?.install).toEqual({
      kind: "npm",
      package: "@agentclientprotocol/claude-agent-acp",
    });
    expect(claude?.featured).toBe(true);
    expect(claude?.wraps).toBe("claude");
    expect(claude?.icon).toBe(
      "https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg",
    );
  });

  it("keeps common registry agents available offline", async () => {
    await loadRegistry({
      cachePath: join(tmpdir(), `backchat-missing-registry-${process.pid}-${Date.now()}.json`),
      ttlMs: 0,
      cacheOnly: true,
    }).catch(() => undefined);

    const ids = getKnownAgents().map((agent) => agent.id);

    expect(ids).toEqual(expect.arrayContaining([
      "codex-acp",
      "claude-acp",
      "gemini",
      "opencode",
      "cursor",
      "qwen-code",
      "github-copilot-cli",
      "kilo",
      "grok-build",
      "amp-acp",
      "goose",
      "cline",
      "auggie",
      "hermes",
      "openclaw",
    ]));
  });

  it("resolves registry agents from Backchat's managed ACP bin directory before PATH", async () => {
    const binDir = join(tmpdir(), `backchat-acp-bin-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const geminiShim = join(binDir, "openma-acp-gemini");
    await writeFile(
      geminiShim,
      "#!/bin/sh\nexec gemini --acp \"$@\"\n",
      { mode: 0o755 },
    );

    const detected = await detect("gemini", {
      env: {
        PATH: "/usr/bin:/bin",
        OPENMA_ACP_BIN_DIR: binDir,
      },
      systemPathFallbackDirs: [],
    });

    expect(detected).toMatchObject({
      id: "gemini",
      spec: { command: geminiShim, args: undefined },
    });
  });

  it("does not detect registry-managed agents from system PATH", async () => {
    const sysDir = join(tmpdir(), `backchat-acp-system-${process.pid}-${Date.now()}`);
    await mkdir(sysDir, { recursive: true });
    const geminiSystem = join(sysDir, "openma-acp-gemini");
    await writeFile(geminiSystem, "#!/usr/bin/env node\n", { mode: 0o755 });

    const detected = await detect("gemini", {
      env: {
        PATH: sysDir,
        OPENMA_ACP_BIN_DIR: join(sysDir, "managed-missing"),
      },
      systemPathFallbackDirs: [],
    });

    expect(detected).toBeNull();
  });
});
