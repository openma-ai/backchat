import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { installAcpRegistryAgent, listAcpRegistryCatalog } from "./installer.js";

describe("ACP registry installer", () => {
  it("lists installable registry agents with platform args and env", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      agents: [
        {
          id: "gemini",
          name: "Gemini",
          version: "1.2.3",
          website: "https://example.test/gemini",
          distribution: {
            npx: {
              package: "@google/gemini-cli@1.2.3",
              args: ["--acp"],
              env: { GEMINI_MODE: "1" },
            },
          },
        },
      ],
    })) as never;

    await expect(listAcpRegistryCatalog({ fetchImpl })).resolves.toEqual([
      {
        id: "gemini",
        name: "Gemini",
        version: "1.2.3",
        homepage: "https://example.test/gemini",
        installable: true,
        args: ["--acp"],
        env: { GEMINI_MODE: "1" },
      },
    ]);
  });

  it("keeps the installed npx command available until an upgrade is ready", async () => {
    const root = join(tmpdir(), `openma-acp-atomic-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = join(root, "fake-npm.mjs");
    const started = join(root, "upgrade-started");
    const release = join(root, "release-upgrade");
    await mkdir(root, { recursive: true });
    await writeFile(fakeNpm, `#!/usr/bin/env node
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args.at(-1);
const packageName = spec.startsWith("@") ? spec.slice(0, spec.indexOf("@", 1)) : spec.split("@")[0];
const parts = packageName.split("/");
const binName = basename(packageName);
await rm(prefix, { recursive: true, force: true });
if (process.env.TEST_INSTALL_STARTED) {
  await writeFile(process.env.TEST_INSTALL_STARTED, "started");
  while (true) {
    try { await access(process.env.TEST_INSTALL_RELEASE); break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const packageDir = join(prefix, "node_modules", ...parts);
await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true });
await mkdir(packageDir, { recursive: true });
await writeFile(join(packageDir, "package.json"), JSON.stringify({ bin: { [binName]: "cli.js" } }));
await writeFile(join(prefix, "node_modules", ".bin", binName), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
`, "utf8");
    await chmod(fakeNpm, 0o755);

    let version = "1.0.0";
    const fetchImpl = async () => new Response(JSON.stringify({
      agents: [{
        id: "example-agent",
        version,
        distribution: { npx: { package: `@example/agent@${version}` } },
      }],
    }), { status: 200 });

    await installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const shimPath = join(binDir, "example-agent");
    const oldShim = await readFile(shimPath, "utf8");
    const oldCommand = shellShimCommand(oldShim);
    expect(oldCommand).toContain("v_1.0.0_");
    await expect(access(oldCommand)).resolves.toBeUndefined();

    version = "2.0.0";
    const upgrading = installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      fetchImpl: fetchImpl as typeof fetch,
      env: {
        ...process.env,
        TEST_INSTALL_STARTED: started,
        TEST_INSTALL_RELEASE: release,
      },
    });

    await waitForFile(started);
    expect(await readFile(shimPath, "utf8")).toBe(oldShim);
    await expect(access(oldCommand)).resolves.toBeUndefined();

    await writeFile(release, "release");
    await upgrading;
    const newCommand = shellShimCommand(await readFile(shimPath, "utf8"));
    expect(newCommand).toContain("v_2.0.0_");
    expect(newCommand).not.toBe(oldCommand);
    await expect(access(newCommand)).resolves.toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  it("installs from a supplied registry snapshot without fetching it again", async () => {
    const root = join(tmpdir(), `openma-acp-snapshot-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = await writeFakeNpm(root);
    let fetchCount = 0;

    await installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      registryAgent: {
        id: "example-agent",
        version: "1.0.0",
        distribution: { npx: { package: "@example/agent@1.0.0" } },
      },
      fetchImpl: (async () => {
        fetchCount += 1;
        throw new Error("registry should not be fetched");
      }) as typeof fetch,
    });

    expect(fetchCount).toBe(0);
    await rm(root, { recursive: true, force: true });
  });

  it("installs an npx upgrade into a clean version directory", async () => {
    const root = join(tmpdir(), `openma-acp-clean-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = await writeFakeNpm(root);
    let version = "1.0.0";
    const fetchImpl = async () => new Response(JSON.stringify({
      agents: [{
        id: "example-agent",
        version,
        distribution: { npx: { package: `@example/agent@${version}` } },
      }],
    }), { status: 200 });

    await installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const oldCommand = shellShimCommand(await readFile(join(binDir, "example-agent"), "utf8"));
    const oldPrefix = dirname(dirname(dirname(oldCommand)));
    await writeFile(join(oldPrefix, "reuse-marker"), "reuse me");

    version = "2.0.0";
    await installAcpRegistryAgent({
      registryId: "example-agent",
      shimName: "example-agent",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      fetchImpl: fetchImpl as typeof fetch,
      env: {
        ...process.env,
        TEST_REJECT_SEED: "1",
      },
    });

    await rm(root, { recursive: true, force: true });
  });

  it("retries an ETARGET npx install against the online registry", async () => {
    const root = join(tmpdir(), `openma-acp-etarget-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    const fakeNpm = join(root, "fake-npm-etarget.mjs");
    const callsPath = join(root, "npm-calls.log");
    await mkdir(root, { recursive: true });
    await writeFile(fakeNpm, `#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
await appendFile(process.env.TEST_NPM_CALLS, args.join(" ") + "\\n");
if (args.includes("--prefer-offline")) {
  console.error("npm error code ETARGET");
  console.error("npm error notarget No matching version found");
  process.exit(1);
}
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args.at(-1);
const packageName = spec.startsWith("@") ? spec.slice(0, spec.indexOf("@", 1)) : spec.split("@")[0];
const parts = packageName.split("/");
const binName = basename(packageName);
const packageDir = join(prefix, "node_modules", ...parts);
await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true });
await mkdir(packageDir, { recursive: true });
await writeFile(join(packageDir, "package.json"), JSON.stringify({ bin: { [binName]: "cli.js" } }));
await writeFile(join(prefix, "node_modules", ".bin", binName), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
`, "utf8");
    await chmod(fakeNpm, 0o755);

    await installAcpRegistryAgent({
      registryId: "gemini",
      shimName: "gemini",
      binDir,
      installRoot: root,
      npmCommand: fakeNpm,
      registryAgent: {
        id: "gemini",
        version: "0.51.0",
        distribution: { npx: { package: "@google/gemini-cli@0.51.0" } },
      },
      env: {
        ...process.env,
        TEST_NPM_CALLS: callsPath,
      },
    });

    const calls = await readFile(callsPath, "utf8");
    expect(calls).toContain("--prefer-offline");
    expect(calls).toContain("--prefer-online");
    await rm(root, { recursive: true, force: true });
  });
});

async function writeFakeNpm(root: string): Promise<string> {
  const fakeNpm = join(root, "fake-npm-seeded.mjs");
  await mkdir(root, { recursive: true });
  await writeFile(fakeNpm, `#!/usr/bin/env node
import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
const spec = args.at(-1);
const packageName = spec.startsWith("@") ? spec.slice(0, spec.indexOf("@", 1)) : spec.split("@")[0];
const parts = packageName.split("/");
const binName = basename(packageName);
if (process.env.TEST_REJECT_SEED) {
  try {
    await access(join(prefix, "reuse-marker"));
    throw new Error("upgrade directory inherited files from the active version");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const packageDir = join(prefix, "node_modules", ...parts);
await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true });
await mkdir(packageDir, { recursive: true });
await writeFile(join(packageDir, "package.json"), JSON.stringify({ bin: { [binName]: "cli.js" } }));
await writeFile(join(prefix, "node_modules", ".bin", binName), "#!/bin/sh\\nexit 0\\n", { mode: 0o755 });
`, "utf8");
  await chmod(fakeNpm, 0o755);
  return fakeNpm;
}

function shellShimCommand(shim: string): string {
  const match = shim.match(/^exec '([^']+)'/m);
  if (!match?.[1]) throw new Error(`Could not parse shim: ${shim}`);
  return match[1];
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
