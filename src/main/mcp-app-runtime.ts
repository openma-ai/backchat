import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { SettingsMcpServer } from "../shared/settings.js";
import type {
  McpAppRequestInput,
  McpAppResolved,
  McpAppResolveInput,
  McpAppResourceMeta,
} from "../shared/mcp-app.js";
import { MCP_APP_ALLOWED_METHODS } from "../shared/mcp-app.js";
import { registerMcpAppDocument } from "./mcp-app-document-store.js";

export const MCP_APP_EXTENSION_ID = "io.modelcontextprotocol/ui";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

export function buildMcpAppClientCapabilities(): {
  extensions: Record<string, { mimeTypes: string[] }>;
} {
  return {
    extensions: {
      [MCP_APP_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] },
    },
  };
}

export interface McpAppToolMatch extends Tool {
  resourceUri: string;
}

function namesMatch(acpName: string, tool: Tool): boolean {
  const needle = acpName.trim().toLowerCase();
  const name = tool.name.toLowerCase();
  const title = tool.title?.toLowerCase();
  return needle === name || needle === title || needle.endsWith(`__${name}`);
}

export function findMcpAppTool(
  acpToolName: string | undefined,
  tools: Tool[],
  requestedResourceUri?: string,
): McpAppToolMatch | undefined {
  const candidates = tools.flatMap((tool) => {
    let resourceUri: string | undefined;
    try {
      resourceUri = getToolUiResourceUri(tool);
    } catch {
      return [];
    }
    if (!resourceUri?.startsWith("ui://")) return [];
    if (requestedResourceUri && resourceUri !== requestedResourceUri) return [];
    if (acpToolName && !namesMatch(acpToolName, tool)) return [];
    return [{ ...tool, resourceUri }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function headers(entries: Array<{ name: string; value: string }>): Headers {
  return new Headers(entries.map(({ name, value }) => [name, value]));
}

function contentUiMeta(value: unknown): McpAppResourceMeta | undefined {
  if (!value || typeof value !== "object") return undefined;
  const meta = (value as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") return undefined;
  const ui = (meta as { ui?: unknown }).ui;
  return ui && typeof ui === "object" ? (ui as McpAppResourceMeta) : undefined;
}

interface ConnectedServer {
  client: Client;
  server: SettingsMcpServer;
}

/** A lazy, UI-only companion connection. The ACP agent remains the owner of
 * ordinary MCP execution. This connection exists because current ACP only
 * injects server descriptors and does not expose resources/read back to Host. */
export class McpAppRuntime {
  readonly #getServers: () => readonly SettingsMcpServer[];
  readonly #connections = new Map<string, Promise<ConnectedServer>>();
  readonly #resolvedResources = new Map<string, Promise<McpAppResolved | null>>();

  constructor(getServers: () => readonly SettingsMcpServer[]) {
    this.#getServers = getServers;
  }

  async #connect(server: SettingsMcpServer): Promise<ConnectedServer> {
    const existing = this.#connections.get(server.id);
    if (existing) return existing;
    const pending = (async () => {
      const client = new Client(
        { name: "Backchat MCP Apps Host", version: "0.0.1" },
        { capabilities: buildMcpAppClientCapabilities() },
      );
      if (server.type === "stdio") {
        await client.connect(new StdioClientTransport({
          command: server.command,
          args: server.args,
          env: {
            ...getDefaultEnvironment(),
            ...Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
          },
          stderr: "pipe",
        }));
      } else if (server.type === "sse") {
        await client.connect(new SSEClientTransport(new URL(server.url), {
          requestInit: { headers: headers(server.headers) },
        }));
      } else {
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: headers(server.headers) },
        }));
      }
      return { client, server };
    })();
    this.#connections.set(server.id, pending);
    try {
      return await pending;
    } catch (error) {
      this.#connections.delete(server.id);
      throw error;
    }
  }

  async resolve(input: McpAppResolveInput): Promise<McpAppResolved | null> {
    const cacheKey = JSON.stringify(input);
    const existing = this.#resolvedResources.get(cacheKey);
    if (existing) return existing;
    const pending = this.#resolve(input);
    this.#resolvedResources.set(cacheKey, pending);
    try {
      const resolved = await pending;
      if (!resolved) this.#resolvedResources.delete(cacheKey);
      return resolved;
    } catch (error) {
      this.#resolvedResources.delete(cacheKey);
      throw error;
    }
  }

  async #resolve(input: McpAppResolveInput): Promise<McpAppResolved | null> {
    const toolName = input.tool_name ?? input.tool_title;
    const ordered = this.#getServers().filter((server) =>
      input.server_hint
        ? server.id === input.server_hint || server.name === input.server_hint
        : true,
    );
    const matches: Array<{ connection: ConnectedServer; tool: McpAppToolMatch }> = [];
    for (const server of ordered) {
      try {
        const connection = await this.#connect(server);
        const listed = await connection.client.listTools();
        const tool = findMcpAppTool(toolName, listed.tools, input.resource_uri);
        if (tool) matches.push({ connection, tool });
      } catch (error) {
        process.stderr.write(
          `! MCP App discovery failed for ${server.name}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
    if (matches.length !== 1) return null;
    const { connection, tool } = matches[0]!;
    const resource = await connection.client.readResource({ uri: tool.resourceUri });
    const content = resource.contents.find((item) =>
      item.uri === tool.resourceUri && "text" in item && typeof item.text === "string",
    );
    if (!content || !("text" in content) || typeof content.text !== "string") return null;
    if (content.mimeType && content.mimeType !== MCP_APP_MIME_TYPE) return null;
    const meta = contentUiMeta(content) ?? contentUiMeta(resource);
    return {
      server_id: connection.server.id,
      resource_uri: tool.resourceUri,
      html: content.text,
      document_url: registerMcpAppDocument(content.text, meta?.csp),
      meta,
    };
  }

  async request(input: McpAppRequestInput): Promise<unknown> {
    if (!(MCP_APP_ALLOWED_METHODS as readonly string[]).includes(input.method)) {
      throw new Error(`Unsupported MCP App method: ${input.method}`);
    }
    const server = this.#getServers().find((entry) => entry.id === input.server_id);
    if (!server) throw new Error("MCP App server is no longer configured");
    const { client } = await this.#connect(server);
    const params = input.params ?? {};
    switch (input.method) {
      case "ping": return client.ping();
      case "tools/list": return client.listTools(params);
      case "tools/call": return client.callTool(params as never);
      case "resources/list": return client.listResources(params);
      case "resources/templates/list": return client.listResourceTemplates(params);
      case "resources/read": return client.readResource(params as never);
      case "prompts/list": return client.listPrompts(params);
      case "prompts/get": return client.getPrompt(params as never);
    }
  }

  async close(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    this.#resolvedResources.clear();
    await Promise.allSettled(connections.map(async (pending) => (await pending).client.close()));
  }
}
