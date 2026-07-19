import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { SettingsMcpServer } from "../shared/settings.js";
import type { CodexPluginSkill } from "./codex-plugin-loader.js";

type HttpMcpServer = Extract<SettingsMcpServer, { url: string }> & { type: "http" };

interface PluginSkillsMcpBridgeOptions {
  token?: string;
}

export class PluginSkillsMcpBridge {
  readonly #getSkills: () => readonly CodexPluginSkill[];
  readonly #token: string;
  #server: Server | null = null;
  #origin: string | null = null;

  constructor(
    getSkills: () => readonly CodexPluginSkill[],
    options: PluginSkillsMcpBridgeOptions = {},
  ) {
    this.#getSkills = getSkills;
    this.#token = options.token ?? randomBytes(32).toString("hex");
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolvePromise();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>((resolvePromise) =>
        server.close(() => resolvePromise()));
      throw new Error("Plugin Skills MCP failed to bind a loopback port");
    }
    this.#server = server;
    this.#origin = `http://127.0.0.1:${address.port}`;
    server.unref();
  }

  descriptor(): HttpMcpServer {
    if (!this.#origin) throw new Error("Plugin Skills MCP has not started");
    return {
      id: "openma-plugin-skills",
      type: "http",
      name: "OpenMA Plugin Skills",
      url: `${this.#origin}/mcp`,
      headers: [{ name: "Authorization", value: `Bearer ${this.#token}` }],
    };
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#origin = null;
    if (!server) return;
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    });
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.headers.authorization !== `Bearer ${this.#token}`) {
        writeJson(response, 401, { error: "Unauthorized" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/mcp") {
        writeJson(response, 404, { error: "Not found" });
        return;
      }
      if (request.method !== "POST") {
        writeJson(response, 405, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed" },
          id: null,
        });
        return;
      }
      const body = await readJsonBody(request);
      const mcp = createPluginSkillsServer(this.#getSkills);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcp.connect(transport);
      try {
        await transport.handleRequest(request, response, body);
      } finally {
        await transport.close().catch(() => undefined);
        await mcp.close().catch(() => undefined);
      }
    } catch (error) {
      if (!response.headersSent) {
        writeJson(response, 500, {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
          id: null,
        });
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  }
}

function createPluginSkillsServer(
  getSkills: () => readonly CodexPluginSkill[],
): McpServer {
  const server = new McpServer({
    name: "openma-plugin-skills",
    version: "1.0.0",
  });

  server.registerTool("plugin_search_skills", {
    title: "Search installed plugin skills",
    description:
      "Search Codex-compatible plugin workflows before starting work that may match an installed skill. Read a matching skill before following it.",
    inputSchema: {
      query: z.string().default(""),
      limit: z.number().int().positive().max(50).optional().default(20),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => textResult(
    searchSkills(getSkills(), query, limit).map((skill) => ({
      id: `${skill.pluginName}:${skill.name}`,
      description: skill.description,
    })),
  ));

  server.registerTool("plugin_read_skill", {
    title: "Read an installed plugin skill",
    description:
      "Read the complete SKILL.md instructions for a matching Codex-compatible plugin skill.",
    inputSchema: {
      skill: z.string().describe("Namespaced skill id returned by plugin_search_skills"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ skill }) => {
    const match = getSkills().find((entry) =>
      `${entry.pluginName}:${entry.name}` === skill);
    if (!match) throw new Error(`Unknown plugin skill: ${skill}`);
    return textResult(readSkill(match));
  });

  server.registerTool("plugin_read_file", {
    title: "Read a plugin skill file",
    description:
      "Read a relative reference, script, template, or asset text file from an installed plugin after its SKILL.md asks for it.",
    inputSchema: {
      plugin: z.string(),
      path: z.string().describe("A ./-prefixed path relative to the plugin root"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ plugin, path }) => {
    const pluginRoot = getSkills().find((entry) =>
      entry.pluginName === plugin)?.pluginRoot;
    if (!pluginRoot) throw new Error(`Unknown plugin: ${plugin}`);
    const file = resolveReadablePluginFile(pluginRoot, path);
    return textResult(readFileSync(file, "utf8"));
  });

  return server;
}

function readSkill(skill: CodexPluginSkill): string {
  switch (`${skill.pluginName}:${skill.name}`) {
    case "browser:control-in-app-browser":
      return [
        "---",
        "name: control-in-app-browser",
        "description: Control OpenMA's task-scoped in-app browser.",
        "---",
        "",
        "# OpenMA Browser",
        "",
        "Use the browser tools exposed by the OpenMA host. They operate on the visible browser attached to the current task.",
        "",
        "- `browser_tabs`: list, create, select, or close tabs.",
        "- `browser_navigate`: navigate the active tab.",
        "- `browser_get_text`: read visible page text.",
        "- `browser_click`: click a selector or text match.",
        "- `browser_type`: type into an editable element.",
        "- `browser_screenshot`: capture the active tab.",
        "- `browser_eval`: evaluate JavaScript in the active tab.",
        "- `browser_close`: close the active tab.",
        "",
        "Reuse the current task's existing tab when possible. Use purpose-built connectors for semantic service operations when one is available; use these browser tools for visible or interactive UI work.",
      ].join("\n");
    default:
      return readFileSync(skill.file, "utf8");
  }
}

function searchSkills(
  skills: readonly CodexPluginSkill[],
  query: string,
  limit: number,
): CodexPluginSkill[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return skills
    .map((skill) => {
      const name = `${skill.pluginName} ${skill.name}`.toLocaleLowerCase();
      const description = skill.description.toLocaleLowerCase();
      const score = terms.length === 0
        ? 1
        : terms.reduce((total, term) =>
            total
            + (name.includes(term) ? 3 : 0)
            + (description.includes(term) ? 1 : 0), 0);
      return { skill, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score
      || `${left.skill.pluginName}:${left.skill.name}`.localeCompare(
        `${right.skill.pluginName}:${right.skill.name}`,
      ))
    .slice(0, limit)
    .map(({ skill }) => skill);
}

function resolveReadablePluginFile(pluginRoot: string, path: string): string {
  if (!path.startsWith("./")) {
    throw new Error('Plugin file path must start with "./"');
  }
  const root = realpathSync(pluginRoot);
  const candidate = realpathSync(resolve(root, path));
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".."
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)) {
    throw new Error("Plugin file path must stay inside the plugin root");
  }
  const stat = statSync(candidate);
  if (!stat.isFile()) throw new Error("Plugin path is not a file");
  if (stat.size > 1024 * 1024) throw new Error("Plugin file is larger than 1 MiB");
  return candidate;
}

function textResult(value: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }],
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 2 * 1024 * 1024) throw new Error("MCP request is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
