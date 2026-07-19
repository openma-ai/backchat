import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpAppRuntime } from "./mcp-app-runtime.js";
import type { SettingsMcpServer } from "../shared/settings.js";

let httpServer: Server | undefined;
let runtime: McpAppRuntime | undefined;

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  httpServer = undefined;
});

describe("McpAppRuntime", () => {
  it("discovers, reads, and calls an official MCP App over Streamable HTTP", async () => {
    httpServer = createServer((request, response) => {
      void handleMcpRequest(request, response);
    });
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("test server failed to bind");
    const configured: SettingsMcpServer[] = [{
      id: "charts",
      type: "http",
      name: "Charts",
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: [],
    }];
    runtime = new McpAppRuntime(() => configured);

    const resolved = await runtime.resolve({
      tool_name: "mcp__charts__show_sales",
      resource_uri: "ui://charts/sales.html",
    });

    expect(resolved).toMatchObject({
      server_id: "charts",
      resource_uri: "ui://charts/sales.html",
      html: expect.stringContaining("Sales app"),
      meta: { csp: { connectDomains: ["https://api.example.com"] } },
    });
    await expect(runtime.request({
      server_id: "charts",
      method: "tools/call",
      params: { name: "show_sales", arguments: { region: "apac" } },
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "sales:apac" }],
    });
  });
});

function appServer(): McpServer {
  const server = new McpServer({ name: "charts", version: "1.0.0" });
  registerAppTool(server, "show_sales", {
    title: "Show sales",
    inputSchema: { region: z.string() },
    _meta: { ui: { resourceUri: "ui://charts/sales.html" } },
  }, async (args) => ({
    content: [{ type: "text", text: `sales:${String((args as { region?: string }).region)}` }],
  }));
  registerAppResource(server, "Sales app", "ui://charts/sales.html", {}, async () => ({
    contents: [{
      uri: "ui://charts/sales.html",
      mimeType: RESOURCE_MIME_TYPE,
      text: "<!doctype html><html><body>Sales app</body></html>",
      _meta: { ui: { csp: { connectDomains: ["https://api.example.com"] } } },
    }],
  }));
  return server;
}

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = appServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, await readJson(request));
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}
