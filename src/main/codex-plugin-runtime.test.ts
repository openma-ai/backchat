import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexPluginRuntime } from "./codex-plugin-runtime.js";

const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openma-plugin-runtime-")));
  temporaryRoots.push(root);
  return root;
}

async function installPlugin(
  pluginsRoot: string,
  name: string,
  serverName: string,
): Promise<void> {
  const root = join(pluginsRoot, name);
  await mkdir(join(root, ".codex-plugin"), { recursive: true });
  await writeFile(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({
    name,
    mcpServers: "./.mcp.json",
  }), "utf8");
  await writeFile(join(root, ".mcp.json"), JSON.stringify({
    [serverName]: {
      type: "http",
      url: `https://${name}.example/mcp`,
    },
  }), "utf8");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

describe("CodexPluginRuntime", () => {
  it("uses a stable startup snapshot until an explicit refresh", async () => {
    const pluginsRoot = await temporaryDirectory();
    await installPlugin(pluginsRoot, "first", "tools");
    const runtime = new CodexPluginRuntime([pluginsRoot]);

    const started = runtime.start();
    expect(started.plugins.map((plugin) => plugin.manifest.name)).toEqual(["first"]);
    expect(runtime.mcpServers()).toHaveLength(1);

    await installPlugin(pluginsRoot, "second", "more-tools");
    expect(runtime.mcpServers()).toHaveLength(1);

    const refreshed = runtime.refresh();
    expect(refreshed.plugins.map((plugin) => plugin.manifest.name)).toEqual([
      "first",
      "second",
    ]);
    expect(runtime.mcpServers()).toHaveLength(2);
  });

  it("merges user MCP settings without mutating either source", async () => {
    const pluginsRoot = await temporaryDirectory();
    await installPlugin(pluginsRoot, "first", "tools");
    const runtime = new CodexPluginRuntime([pluginsRoot]);
    runtime.start();
    const configured = [{
      id: "personal",
      type: "sse" as const,
      name: "Personal",
      url: "https://personal.example/sse",
      headers: [],
    }];

    const merged = runtime.withConfiguredMcpServers(configured);

    expect(merged.map((server) => server.id)).toEqual([
      "personal",
      "plugin:first:tools",
    ]);
    expect(merged).not.toBe(configured);
  });
});
