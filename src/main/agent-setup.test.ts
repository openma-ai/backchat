import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createAgentSetupService } from "./agent-setup.js";
import { _resetRegistryCache } from "@open-managed-agents-desktop/acp/registry";

describe("agent setup service", () => {
  it("reports managed registry shims as installed and available", async () => {
    const root = join(tmpdir(), `backchat-agent-setup-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const geminiShim = join(binDir, "openma-acp-gemini");
    await writeFile(geminiShim, "#!/usr/bin/env node\n", { mode: 0o755 });

    const service = createAgentSetupService({
      acpBinDir: binDir,
      acpInstallRoot: root,
      registryCachePath: join(root, "registry-cache.json"),
      refreshRegistry: async () => undefined,
    });

    const agents = await service.listAgents();
    const gemini = agents.find((agent) => agent.id === "gemini");
    const qwen = agents.find((agent) => agent.id === "qwen-code");

    expect(gemini).toMatchObject({
      id: "gemini",
      command: geminiShim,
      available: true,
      detected: true,
      installed: true,
      installable: true,
      installSource: "registry",
    });
    expect(qwen).toMatchObject({
      id: "qwen-code",
      available: false,
      detected: false,
      installed: false,
      installable: true,
      installSource: "registry",
    });
  });

  it("marks managed shims with missing metadata as updateable when registry has a latest version", async () => {
    _resetRegistryCache();
    const root = join(tmpdir(), `backchat-agent-setup-version-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const registryCachePath = join(root, "registry-cache.json");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "openma-acp-gemini"), "#!/usr/bin/env node\n", { mode: 0o755 });
    await writeFile(registryCachePath, JSON.stringify({
      fetchedAt: Date.now(),
      data: {
        version: 1,
        agents: [{
          id: "gemini",
          name: "Gemini",
          version: "2.0.0",
          distribution: {
            npx: {
              package: "@google/gemini-cli@2.0.0",
              args: ["--acp"],
            },
          },
        }],
      },
    }));

    const service = createAgentSetupService({
      acpBinDir: binDir,
      acpInstallRoot: root,
      registryCachePath,
    });

    const gemini = (await service.listAgents()).find((agent) => agent.id === "gemini");
    expect(gemini).toMatchObject({
      id: "gemini",
      installed: true,
      latestVersion: "2.0.0",
      updateAvailable: true,
    });
    _resetRegistryCache();
  });

  it("rejects upgrade for agents that are not managed-installed", async () => {
    const root = join(tmpdir(), `backchat-agent-setup-upgrade-${process.pid}-${Date.now()}`);
    const service = createAgentSetupService({
      acpBinDir: join(root, "bin"),
      acpInstallRoot: root,
      registryCachePath: join(root, "registry-cache.json"),
      refreshRegistry: async () => undefined,
    });

    await expect(service.upgradeAgent("gemini")).rejects.toThrow(/not installed by Backchat/);
  });

  it("lists command-backed custom agent servers from settings overrides", async () => {
    const root = join(tmpdir(), `backchat-agent-setup-custom-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const studioBin = join(binDir, "studio-acp");
    await writeFile(studioBin, "#!/usr/bin/env node\n", { mode: 0o755 });

    const service = createAgentSetupService({
      acpBinDir: binDir,
      acpInstallRoot: root,
      registryCachePath: join(root, "registry-cache.json"),
      refreshRegistry: async () => undefined,
      agentOverrides: () => [{
        id: "studio",
        label_override: "Studio ACP",
        command_override: studioBin,
        args_override: ["--acp"],
        env: [{ name: "STUDIO_TOKEN", value: "secret" }],
      }],
    } as never);

    const agents = await service.listAgents();
    const studio = agents.find((agent) => agent.id === "studio");

    expect(studio).toMatchObject({
      id: "studio",
      label: "Studio ACP",
      command: studioBin,
      custom: true,
      available: true,
      detected: true,
      installed: false,
      installable: false,
    });
  });
});
