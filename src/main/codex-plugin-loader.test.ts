import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverCodexPlugins,
  loadCodexPlugin,
} from "./codex-plugin-loader.js";

const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openma-codex-plugin-")));
  temporaryRoots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

describe("loadCodexPlugin", () => {
  it("loads an official Codex bundle and normalizes bundled MCP servers", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, ".codex-plugin"), { recursive: true });
    await mkdir(join(root, "skills", "research"), { recursive: true });
    await mkdir(join(root, "hooks"), { recursive: true });
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(
      join(root, "skills", "research", "SKILL.md"),
      [
        "---",
        "name: research",
        "description: Research official sources before answering.",
        "---",
        "# Research",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(root, "hooks", "hooks.json"), "{}\n", "utf8");
    await writeFile(join(root, ".app.json"), "{\"apps\":{}}\n", "utf8");
    await writeFile(join(root, "bin", "server"), "#!/bin/sh\n", "utf8");
    await writeJson(join(root, ".codex-plugin", "plugin.json"), {
      name: "research-kit",
      version: "1.2.3",
      description: "Research workflows",
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      apps: "./.app.json",
      interface: {
        displayName: "Research Kit",
        logo: "./assets/logo.png",
      },
    });
    await writeJson(join(root, ".mcp.json"), {
      // OpenAI's public Figma plugin currently uses this camelCase wrapper.
      mcpServers: {
        local: {
          command: "./bin/server",
          args: ["--root", "${PLUGIN_ROOT}"],
          env: { TOKEN: "secret" },
        },
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token" },
          oauth_resource: "https://example.com/mcp",
        },
      },
    });

    const plugin = loadCodexPlugin(root);

    expect(plugin.manifest.name).toBe("research-kit");
    expect(plugin.paths.skills).toEqual([join(root, "skills")]);
    expect(plugin.paths.apps).toEqual([join(root, ".app.json")]);
    expect(plugin.paths.hooks).toEqual([join(root, "hooks", "hooks.json")]);
    expect(plugin.skillFiles).toEqual([join(root, "skills", "research", "SKILL.md")]);
    expect(plugin.skills).toEqual([{
      name: "research",
      description: "Research official sources before answering.",
      pluginName: "research-kit",
      pluginRoot: root,
      file: join(root, "skills", "research", "SKILL.md"),
    }]);
    expect(plugin.mcpServers).toEqual([
      {
        id: "plugin:research-kit:local",
        type: "stdio",
        name: "research-kit / local",
        command: join(root, "bin", "server"),
        args: ["--root", root],
        env: [{ name: "TOKEN", value: "secret" }],
      },
      {
        id: "plugin:research-kit:remote",
        type: "http",
        name: "research-kit / remote",
        url: "https://example.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer token" }],
      },
    ]);
    expect(plugin.requirements).toContainEqual({
      kind: "oauth",
      serverId: "plugin:research-kit:remote",
      resource: "https://example.com/mcp",
    });
  });

  it.each([
    ["direct map", { docs: { command: "/usr/bin/docs-mcp", args: [] } }],
    ["snake-case wrapper", {
      mcp_servers: { docs: { command: "/usr/bin/docs-mcp", args: [] } },
    }],
  ])("accepts the documented %s MCP shape", async (_label, mcpManifest) => {
    const root = await temporaryDirectory();
    await mkdir(join(root, ".codex-plugin"), { recursive: true });
    await writeJson(join(root, ".codex-plugin", "plugin.json"), {
      name: "docs",
      mcpServers: "./.mcp.json",
    });
    await writeJson(join(root, ".mcp.json"), mcpManifest);

    expect(loadCodexPlugin(root).mcpServers).toMatchObject([
      {
        id: "plugin:docs:docs",
        type: "stdio",
        command: "/usr/bin/docs-mcp",
      },
    ]);
  });

  it("eliminates plugin cwd from stdio config for ACP compatibility", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, ".codex-plugin"), { recursive: true });
    await mkdir(join(root, "server", "src"), { recursive: true });
    await writeFile(join(root, "server", "src", "server.js"), "", "utf8");
    await writeJson(join(root, ".codex-plugin", "plugin.json"), {
      name: "preference-app",
      mcpServers: "./.mcp.json",
    });
    await writeJson(join(root, ".mcp.json"), {
      mcpServers: {
        app: {
          command: "node",
          args: ["./src/server.js", "--label", "local"],
          cwd: "./server",
        },
      },
    });

    expect(loadCodexPlugin(root).mcpServers).toMatchObject([{
      command: "node",
      args: [join(root, "server", "src", "server.js"), "--label", "local"],
    }]);
  });

  it("rejects manifest paths that escape the plugin root", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, ".codex-plugin"), { recursive: true });
    await writeJson(join(root, ".codex-plugin", "plugin.json"), {
      name: "unsafe",
      skills: "./../secrets",
    });

    expect(() => loadCodexPlugin(root)).toThrow(/inside the plugin root/i);
  });
});

describe("discoverCodexPlugins", () => {
  it("keeps valid plugins when another installed bundle is malformed", async () => {
    const pluginsRoot = await temporaryDirectory();
    const valid = join(pluginsRoot, "valid");
    const invalid = join(pluginsRoot, "invalid");
    await mkdir(join(valid, ".codex-plugin"), { recursive: true });
    await mkdir(join(invalid, ".codex-plugin"), { recursive: true });
    await writeJson(join(valid, ".codex-plugin", "plugin.json"), {
      name: "valid",
    });
    await writeFile(join(invalid, ".codex-plugin", "plugin.json"), "{nope", "utf8");

    const catalog = discoverCodexPlugins([pluginsRoot]);

    expect(catalog.plugins.map((plugin) => plugin.manifest.name)).toEqual(["valid"]);
    expect(catalog.errors).toHaveLength(1);
    expect(catalog.errors[0]?.root).toBe(invalid);
  });
});
