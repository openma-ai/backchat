import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnownAgentEntry } from "@open-managed-agents-desktop/acp/registry";
import { installAcpRegistryAgent } from "@open-managed-agents-desktop/acp/installer";
import {
  _resetOpenMaNpmHarnessUpgradeCheck,
  runOpenMaNpmHarnessUpgradeCheck,
} from "./openma-npm-harness-updater.js";

const piEntry: KnownAgentEntry = {
  id: "pi-acp",
  label: "Pi",
  spec: { command: "openma-acp-pi-acp" },
  registryId: "pi-acp",
  installSource: "registry",
  registryDistribution: {
    npx: { package: "@test/pi-acp" },
  },
};

const probeAgentSessionConfigMock = vi.fn(async () => ({
  configOptions: [],
  availableCommands: [],
  auth: { status: "unknown" as const },
}));

vi.mock("@open-managed-agents-desktop/acp/registry", () => ({
  detectEntry: vi.fn(async (entry: KnownAgentEntry) => entry),
  getKnownAgents: vi.fn(() => [piEntry]),
  loadRegistry: vi.fn(async () => [piEntry]),
}));

vi.mock("@open-managed-agents-desktop/acp/probe", () => ({
  authenticateAgent: vi.fn(),
  probeAgentSessionConfig: probeAgentSessionConfigMock,
  probeAgentAuthStatus: vi.fn(),
  disposeAllAcpSetupProcesses: vi.fn(async () => undefined),
}));

const { createAcpAgentSetupService } = await import("./index.js");

function shellShimCommand(shim: string): string {
  const match = shim.match(/^exec '([^']+)'/m);
  const captured = match?.[1];
  if (captured === undefined) throw new Error("invalid shim");
  return captured;
}

async function writeFakeNpm(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const fakeNpm = join(root, "fake-npm.mjs");
  await writeFile(fakeNpm, `#!/usr/bin/env node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args.at(-1);
const version = spec.includes("@") ? spec.slice(spec.lastIndexOf("@") + 1) : "0.0.0";
const packageName = spec.startsWith("@")
  ? spec.slice(0, spec.indexOf("@", 1))
  : spec.split("@")[0];
const parts = packageName.split("/");
const binName = basename(packageName);
await rm(prefix, { recursive: true, force: true });
const packageDir = join(prefix, "node_modules", ...parts);
await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true });
await mkdir(packageDir, { recursive: true });
await writeFile(
  join(packageDir, "package.json"),
  JSON.stringify({ name: packageName, version, bin: { [binName]: "cli.js" } }),
);
await writeFile(join(prefix, "node_modules", ".bin", binName), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
`, "utf8");
  await chmod(fakeNpm, 0o755);
  return fakeNpm;
}

async function seedPiInstall(root: string, version: string): Promise<void> {
  const binDir = join(root, "bin");
  const fakeNpm = await writeFakeNpm(root);
  await mkdir(binDir, { recursive: true });
  await installAcpRegistryAgent({
    registryId: "pi-acp",
    shimName: "openma-acp-pi-acp",
    binDir,
    installRoot: root,
    npmCommand: fakeNpm,
    registryAgent: {
      id: "pi-acp",
      version,
      distribution: { npx: { package: `@test/pi-acp@${version}` } },
    },
  });
}

describe("openma npm harness auto-updater", () => {
  beforeEach(() => {
    _resetOpenMaNpmHarnessUpgradeCheck();
    probeAgentSessionConfigMock.mockClear();
  });

  it("installs npm latest and moves the shim for managed pi-acp harnesses", async () => {
    const root = join(tmpdir(), `openma-harness-updater-${process.pid}-${Date.now()}`);
    await seedPiInstall(root, "1.0.1");
    const binDir = join(root, "bin");
    const shimPath = join(binDir, "openma-acp-pi-acp");
    const beforeCommand = shellShimCommand(await readFile(shimPath, "utf8"));
    expect(beforeCommand).toContain("v_1.0.1_");

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      "dist-tags": { latest: "1.0.2" },
    }), { status: 200 })) as typeof fetch;
    const fakeNpm = await writeFakeNpm(root);
    const service = createAcpAgentSetupService({
      acpBinDir: binDir,
      acpInstallRoot: root,
      registryCachePath: join(root, "registry.json"),
      refreshRegistry: async () => undefined,
      npmCommand: fakeNpm,
      fetchImpl,
    });

    const events: string[] = [];
    const outcomes = await runOpenMaNpmHarnessUpgradeCheck(
      service,
      { acpBinDir: binDir, acpInstallRoot: root, fetchImpl, catalogEntries: () => [piEntry] },
      "startup",
      (event) => {
        if (event.kind === "version-changed") {
          events.push(`${event.fromVersion}->${event.toVersion}`);
        }
      },
    );

    expect(outcomes).toEqual([
      { agentId: "pi-acp", action: "upgraded", fromVersion: "1.0.1", toVersion: "1.0.2" },
    ]);
    expect(events).toEqual(["1.0.1->1.0.2"]);
    const afterCommand = shellShimCommand(await readFile(shimPath, "utf8"));
    expect(afterCommand).toContain("v_1.0.2_");
    expect(afterCommand).not.toBe(beforeCommand);
    expect(beforeCommand).not.toContain("v_1.0.2_");
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the current install when npm latest cannot be resolved", async () => {
    const root = join(tmpdir(), `openma-harness-updater-offline-${process.pid}-${Date.now()}`);
    await seedPiInstall(root, "1.0.1");
    const binDir = join(root, "bin");
    const shimBefore = await readFile(join(binDir, "openma-acp-pi-acp"), "utf8");
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const upgradeAgent = vi.fn();
    const outcomes = await runOpenMaNpmHarnessUpgradeCheck(
      { upgradeAgent },
      { acpBinDir: binDir, acpInstallRoot: root, fetchImpl, catalogEntries: () => [piEntry] },
      "periodic",
    );

    expect(outcomes).toEqual([
      { agentId: "pi-acp", action: "skipped", reason: "up-to-date" },
    ]);
    expect(upgradeAgent).not.toHaveBeenCalled();
    expect(await readFile(join(binDir, "openma-acp-pi-acp"), "utf8")).toBe(shimBefore);
    await rm(root, { recursive: true, force: true });
  });
});
