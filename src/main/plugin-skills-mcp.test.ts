import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { CodexPluginRuntime } from "./codex-plugin-runtime.js";
import { PluginSkillsMcpBridge } from "./plugin-skills-mcp.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("PluginSkillsMcpBridge", () => {
  it("lets any MCP client search and read an unmodified Codex plugin skill", async () => {
    const pluginsRoot = await realpath(
      await mkdtemp(join(tmpdir(), "openma-plugin-skills-")),
    );
    cleanups.push(() => rm(pluginsRoot, { recursive: true, force: true }));
    const pluginRoot = join(pluginsRoot, "research-kit");
    const skillRoot = join(pluginRoot, "skills", "research");
    await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
      name: "research-kit",
      skills: "./skills/",
    }), "utf8");
    await writeFile(join(skillRoot, "SKILL.md"), [
      "---",
      "name: research",
      "description: Research official sources before answering.",
      "---",
      "Read references/checklist.md.",
    ].join("\n"), "utf8");
    await writeFile(
      join(skillRoot, "references", "checklist.md"),
      "Use primary sources.",
      "utf8",
    );

    const runtime = new CodexPluginRuntime([pluginsRoot]);
    runtime.start();
    const bridge = new PluginSkillsMcpBridge(() => runtime.skills(), {
      token: "test-token",
    });
    await bridge.start();
    cleanups.push(() => bridge.stop());
    const descriptor = bridge.descriptor();
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: {
        headers: Object.fromEntries(
          descriptor.headers.map(({ name, value }) => [name, value]),
        ),
      },
    }));
    cleanups.push(() => client.close());

    const search = await client.callTool({
      name: "plugin_search_skills",
      arguments: { query: "official research" },
    });
    expect(JSON.stringify(search.content)).toContain("research-kit:research");

    const skill = await client.callTool({
      name: "plugin_read_skill",
      arguments: { skill: "research-kit:research" },
    });
    expect(JSON.stringify(skill.content)).toContain("Read references/checklist.md.");

    const reference = await client.callTool({
      name: "plugin_read_file",
      arguments: {
        plugin: "research-kit",
        path: "./skills/research/references/checklist.md",
      },
    });
    expect(JSON.stringify(reference.content)).toContain("Use primary sources.");
  });

  it("adapts the Codex Browser skill to OpenMA's task-scoped browser tools", async () => {
    const pluginsRoot = await realpath(
      await mkdtemp(join(tmpdir(), "openma-browser-plugin-")),
    );
    cleanups.push(() => rm(pluginsRoot, { recursive: true, force: true }));
    const pluginRoot = join(pluginsRoot, "browser");
    const skillRoot = join(pluginRoot, "skills", "control-in-app-browser");
    await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
      name: "browser",
      skills: "./skills/",
    }), "utf8");
    await writeFile(join(skillRoot, "SKILL.md"), [
      "---",
      "name: control-in-app-browser",
      "description: Control the in-app Browser.",
      "---",
      "Use the ChatGPT-only node_repl browser client.",
    ].join("\n"), "utf8");

    const runtime = new CodexPluginRuntime([pluginsRoot]);
    runtime.start();
    const bridge = new PluginSkillsMcpBridge(() => runtime.skills(), {
      token: "test-token",
    });
    await bridge.start();
    cleanups.push(() => bridge.stop());
    const descriptor = bridge.descriptor();
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: {
        headers: Object.fromEntries(
          descriptor.headers.map(({ name, value }) => [name, value]),
        ),
      },
    }));
    cleanups.push(() => client.close());

    const skill = await client.callTool({
      name: "plugin_read_skill",
      arguments: { skill: "browser:control-in-app-browser" },
    });
    const content = JSON.stringify(skill.content);
    expect(content).toContain("browser_navigate");
    expect(content).not.toContain("node_repl");
  });
});
