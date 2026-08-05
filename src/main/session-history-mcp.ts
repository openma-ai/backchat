import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { SettingsMcpServer } from "../shared/settings.js";

export interface SessionHistoryListInput {
  query?: string;
  limit?: number;
}

export interface SessionHistoryReadInput {
  session_id: string;
  after_seq?: number;
  max_chars?: number;
  include_activity?: boolean;
}

export interface SessionHistoryToolTarget {
  list(taskId: string, input: SessionHistoryListInput): Promise<unknown>;
  read(taskId: string, input: SessionHistoryReadInput): Promise<unknown>;
}

interface SessionHistoryMcpBridgeOptions {
  token?: string;
}

type HttpMcpServer = Extract<SettingsMcpServer, { url: string }> & { type: "http" };

export class SessionHistoryMcpBridge {
  readonly #tools: SessionHistoryToolTarget;
  readonly #token: string;
  #server: Server | null = null;
  #origin: string | null = null;

  constructor(
    tools: SessionHistoryToolTarget,
    options: SessionHistoryMcpBridgeOptions = {},
  ) {
    this.#tools = tools;
    this.#token = options.token ?? randomBytes(32).toString("hex");
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error("Session History MCP failed to bind a loopback port");
    }
    this.#server = server;
    server.unref();
    this.#origin = `http://127.0.0.1:${address.port}`;
  }

  descriptor(taskId: string): HttpMcpServer {
    if (!this.#origin) throw new Error("Session History MCP has not started");
    return {
      id: "openma-sessions",
      type: "http",
      name: "OpenMA Sessions",
      url: `${this.#origin}/mcp/${encodeURIComponent(taskId)}`,
      headers: [{ name: "Authorization", value: `Bearer ${this.#token}` }],
    };
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#origin = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.headers.authorization !== `Bearer ${this.#token}`) {
        writeJson(response, 401, { error: "Unauthorized" });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const match = url.pathname.match(/^\/mcp\/([^/]+)$/);
      if (!match) {
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

      const taskId = decodeURIComponent(match[1]!);
      const body = await readJsonBody(request);
      const mcp = createTaskMcpServer(taskId, this.#tools);
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

function createTaskMcpServer(
  taskId: string,
  tools: SessionHistoryToolTarget,
): McpServer {
  const server = new McpServer({
    name: "openma-sessions",
    version: "1.0.0",
  });

  server.registerTool("openma_sessions_list", {
    title: "List OpenMA sessions",
    description: "List other local OpenMA sessions that can be referenced from the current task.",
    inputSchema: {
      query: z.string().trim().min(1).optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async (input) => textResult(await tools.list(taskId, input)));

  server.registerTool("openma_sessions_read", {
    title: "Read an OpenMA session",
    description: "Read the user and assistant conversation from another local OpenMA session by its stable session ID.",
    inputSchema: {
      session_id: z.string().min(1),
      after_seq: z.number().int().nonnegative().optional(),
      max_chars: z.number().int().positive().max(100_000).optional(),
      include_activity: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true },
  }, async (input) => {
    if (input.session_id === taskId) {
      throw new Error("Use the current conversation context instead of reading the current session");
    }
    return textResult(await tools.read(taskId, input));
  });

  return server;
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
