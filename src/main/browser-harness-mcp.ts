import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { SettingsMcpServer } from "../shared/settings.js";
import type {
  BrowserTabsInput,
  BrowserTabsResult,
} from "./browser-webview-tools.js";

export interface BrowserHarnessToolTarget {
  tabs(taskId: string, input: BrowserTabsInput): Promise<BrowserTabsResult>;
  navigate(taskId: string, url: string): Promise<Record<string, unknown>>;
  click(taskId: string, selector: string): Promise<string>;
  type(taskId: string, selector: string, text: string, submit?: boolean): Promise<string>;
  getText(taskId: string, selector?: string, maxChars?: number): Promise<string>;
  evaluate(taskId: string, expression: string): Promise<unknown>;
  screenshot(taskId: string, fullPage?: boolean): Promise<{
    media_type: "image/png";
    data: string;
    tab_id: string;
    url: string;
  }>;
  close(taskId: string): Promise<BrowserTabsResult>;
}

interface BrowserHarnessMcpBridgeOptions {
  token?: string;
}

type HttpMcpServer = Extract<SettingsMcpServer, { url: string }> & { type: "http" };

export class BrowserHarnessMcpBridge {
  readonly #tools: BrowserHarnessToolTarget;
  readonly #token: string;
  #server: Server | null = null;
  #origin: string | null = null;

  constructor(tools: BrowserHarnessToolTarget, options: BrowserHarnessMcpBridgeOptions = {}) {
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
      throw new Error("Browser Harness MCP failed to bind a loopback port");
    }
    this.#server = server;
    server.unref();
    this.#origin = `http://127.0.0.1:${address.port}`;
  }

  descriptor(taskId: string): HttpMcpServer {
    if (!this.#origin) throw new Error("Browser Harness MCP has not started");
    return {
      id: "backchat-browser",
      type: "http",
      name: "Backchat Browser",
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
  tools: BrowserHarnessToolTarget,
): McpServer {
  const server = new McpServer({
    name: "backchat-browser",
    version: "1.0.0",
  });

  server.registerTool("browser_tabs", {
    title: "Browser tabs",
    description: "List, open, select, or close tabs in this task's visible Backchat browser window.",
    inputSchema: {
      action: z.enum(["list", "new", "select", "close"]),
      url: z.string().optional(),
      tab_id: z.string().optional(),
      index: z.number().int().nonnegative().optional(),
    },
  }, async (input) => textResult(await tools.tabs(taskId, input as BrowserTabsInput)));

  server.registerTool("browser_navigate", {
    title: "Navigate browser",
    description: "Navigate the active tab in this task's visible Backchat browser window.",
    inputSchema: { url: z.string() },
  }, async ({ url }) => textResult(await tools.navigate(taskId, url)));

  server.registerTool("browser_screenshot", {
    title: "Screenshot browser",
    description: "Capture the active in-app browser tab as PNG.",
    inputSchema: { full_page: z.boolean().optional().default(false) },
    annotations: { readOnlyHint: true },
  }, async ({ full_page }) => {
    const result = await tools.screenshot(taskId, full_page);
    return {
      content: [
        { type: "image" as const, mimeType: result.media_type, data: result.data },
        {
          type: "text" as const,
          text: JSON.stringify({ tab_id: result.tab_id, url: result.url }),
        },
      ],
    };
  });

  server.registerTool("browser_click", {
    title: "Click browser element",
    description: "Click a CSS selector, text= label, or :has-text() match in the active in-app tab.",
    inputSchema: { selector: z.string() },
  }, async ({ selector }) => textResult(await tools.click(taskId, selector)));

  server.registerTool("browser_type", {
    title: "Type in browser",
    description: "Type into an editable element in the active in-app tab.",
    inputSchema: {
      selector: z.string(),
      text: z.string(),
      submit: z.boolean().optional().default(false),
    },
  }, async ({ selector, text, submit }) =>
    textResult(await tools.type(taskId, selector, text, submit)));

  server.registerTool("browser_get_text", {
    title: "Read browser text",
    description: "Read visible text from the active in-app tab or a matching element.",
    inputSchema: {
      selector: z.string().optional(),
      max_chars: z.number().int().positive().max(100_000).optional().default(30_000),
    },
    annotations: { readOnlyHint: true },
  }, async ({ selector, max_chars }) => ({
    content: [{
      type: "text" as const,
      text: await tools.getText(taskId, selector, max_chars),
    }],
  }));

  server.registerTool("browser_eval", {
    title: "Evaluate browser JavaScript",
    description: "Evaluate JavaScript in the active in-app browser tab and return its result.",
    inputSchema: { expression: z.string() },
  }, async ({ expression }) => textResult(await tools.evaluate(taskId, expression)));

  server.registerTool("browser_close", {
    title: "Close browser tab",
    description: "Close the active tab in this task's in-app browser window.",
    inputSchema: {},
  }, async () => textResult(await tools.close(taskId)));

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
