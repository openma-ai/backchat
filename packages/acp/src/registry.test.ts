import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetRegistryCache,
  detect,
  detectEntry,
  getKnownAgents,
  loadRegistry,
} from "./registry.js";

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

  it("replaces the legacy Kimi CLI registry entry with Kimi Code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: 1,
            agents: [
              {
                id: "kimi",
                name: "Kimi CLI",
                version: "1.49.0",
                repository: "https://github.com/MoonshotAI/kimi-cli",
                distribution: {
                  binary: {
                    "darwin-aarch64": {
                      archive: "https://example.invalid/kimi-cli-1.49.0.tar.gz",
                      cmd: "./kimi",
                      args: ["acp"],
                    },
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
    const kimi = agents.find((agent) => agent.id === "kimi");

    expect(kimi).toMatchObject({
      label: "Kimi Code",
      version: "0.33.0",
      spec: { command: "openma-acp-kimi", args: ["acp"] },
      install: { kind: "npm", package: "@moonshot-ai/kimi-code" },
      registryDistribution: {
        npx: { package: "@moonshot-ai/kimi-code@0.33.0", args: ["acp"] },
      },
      homepage: "https://github.com/MoonshotAI/kimi-code",
    });
  });

  it.each(["npx", "binary"] as const)(
    "keeps Pi on OpenMA's npm release when the registry advertises the older %s adapter",
    async (kind) => {
      const platform = `${process.platform === "win32" ? "windows" : process.platform}-${
        process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
      }`;
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        version: 1,
        agents: [{
          id: "pi-acp",
          name: "pi ACP",
          version: "0.0.33",
          repository: "https://github.com/svkozak/pi-acp",
          distribution: kind === "npx"
            ? { npx: { package: "pi-acp@0.0.33", args: ["--legacy"] } }
            : { binary: { [platform]: {
                archive: "https://example.invalid/pi-acp-0.0.33.tar.gz",
                cmd: "./pi-acp",
                args: ["--legacy"],
              } } },
        }],
      }), { status: 200 })));

      const agents = await loadRegistry({ forceRefresh: true });
      const pi = agents.find((agent) => agent.id === "pi-acp");

      expect(pi?.registryDistribution).toEqual({ npx: { package: "@openma/pi-acp" } });
      // Version belongs to the selected package. Leaving it unpinned makes setup
      // resolve @openma/pi-acp's npm dist-tag rather than the old adapter's version.
      expect(pi?.version).toBeUndefined();
      expect(pi?.spec).toEqual({ command: "openma-acp-pi-acp" });
      expect(pi?.install).toEqual({ kind: "npm", package: "@openma/pi-acp" });
      expect(pi?.homepage).toBe("https://github.com/openma-ai/pi-acp");
    },
  );

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
      "pi-acp",
      "gemini",
      "opencode",
      "cursor",
      "qwen-code",
      "github-copilot-cli",
      "kilo",
      "kimi",
      "grok-build",
      "amp-acp",
      "goose",
      "cline",
      "auggie",
      "hermes",
      "openclaw",
      "dsh-acp",
    ]));
    expect(getKnownAgents().find((agent) => agent.id === "pi-acp")).toMatchObject({
      registryId: "pi-acp",
      installSource: "registry",
      spec: { command: "openma-acp-pi-acp" },
      install: { kind: "npm", package: "@openma/pi-acp" },
      registryDistribution: { npx: { package: "@openma/pi-acp" } },
    });
  });

  it("ships an installable DeepSeek Harness distribution before the official registry entry lands", async () => {
    await loadRegistry({
      cachePath: join(tmpdir(), `backchat-missing-registry-${process.pid}-${Date.now()}.json`),
      ttlMs: 0,
      cacheOnly: true,
    }).catch(() => undefined);

    expect(getKnownAgents().find((agent) => agent.id === "dsh-acp")).toMatchObject({
      id: "dsh-acp",
      featured: true,
      registryId: "dsh-acp",
      installSource: "registry",
      registryDistribution: {
        npx: { package: "@openma/deepseek-harness-acp" },
      },
    });
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

  it("preserves custom spawn args when a registry agent command is overridden", async () => {
    const binDir = join(tmpdir(), `backchat-acp-bin-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const codex = getKnownAgents().find((agent) => agent.id === "codex-acp");
    expect(codex).toBeDefined();
    const fakeScript = join(binDir, "fake-acp-agent.mjs");
    await writeFile(fakeScript, "export {};\n");

    const detected = await detectEntry(
      {
        ...codex!,
        spec: {
          ...codex!.spec,
          command: process.execPath,
          args: [fakeScript],
        },
      },
      {
        env: {
          PATH: "/usr/bin:/bin",
          OPENMA_ACP_BIN_DIR: binDir,
        },
        managedBinDirs: [binDir],
      },
    );

    expect(detected).toMatchObject({
      id: "codex-acp",
      spec: { command: process.execPath, args: [fakeScript] },
    });
  });

  it("runs Cursor from cursor-agent acp on PATH and prefers the managed shim", async () => {
    const sysDir = join(tmpdir(), `backchat-cursor-path-${process.pid}-${Date.now()}`);
    await mkdir(sysDir, { recursive: true });
    const cursorAgent = join(sysDir, "cursor-agent");
    await writeFile(cursorAgent, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const fromPath = await detect("cursor", {
      env: { PATH: sysDir, OPENMA_ACP_BIN_DIR: join(sysDir, "missing") },
      systemPathFallbackDirs: [],
    });
    expect(fromPath).toMatchObject({
      id: "cursor",
      spec: { command: cursorAgent, args: ["acp"] },
    });

    const binDir = join(tmpdir(), `backchat-cursor-shim-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const shim = join(binDir, "openma-acp-cursor");
    await writeFile(shim, "#!/bin/sh\nexec cursor-agent acp \"$@\"\n", { mode: 0o755 });
    const fromShim = await detect("cursor", {
      env: { PATH: sysDir, OPENMA_ACP_BIN_DIR: binDir },
      systemPathFallbackDirs: [],
    });
    expect(fromShim).toMatchObject({
      id: "cursor",
      spec: { command: shim, args: undefined },
    });
  });
});
