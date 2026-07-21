import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { SettingsMcpServer } from "../shared/settings.js";
import type {
  ScheduleNotificationPolicy,
  ScheduleTarget,
  ScheduleTrigger,
} from "../shared/schedules.js";

export interface HarnessCreateScheduleInput {
  name: string;
  prompt: string;
  trigger: ScheduleTrigger;
  target: ScheduleTarget;
  notificationPolicy?: ScheduleNotificationPolicy;
}

export interface HarnessUpdateScheduleInput {
  id: string;
  name?: string;
  prompt?: string;
  trigger?: ScheduleTrigger;
  target?: ScheduleTarget;
  status?: "active" | "paused";
  notificationPolicy?: ScheduleNotificationPolicy;
}

export interface ScheduleHarnessToolTarget {
  create(taskId: string, input: HarnessCreateScheduleInput): Promise<unknown>;
  list(taskId: string): Promise<unknown>;
  update(taskId: string, input: HarnessUpdateScheduleInput): Promise<unknown>;
  delete(taskId: string, id: string): Promise<void>;
}

interface ScheduleHarnessMcpBridgeOptions {
  token?: string;
}

type HttpMcpServer = Extract<SettingsMcpServer, { url: string }> & { type: "http" };

export class ScheduleHarnessMcpBridge {
  readonly #tools: ScheduleHarnessToolTarget;
  readonly #token: string;
  #server: Server | null = null;
  #origin: string | null = null;

  constructor(tools: ScheduleHarnessToolTarget, options: ScheduleHarnessMcpBridgeOptions = {}) {
    this.#tools = tools;
    this.#token = options.token ?? randomBytes(32).toString("hex");
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const server = createServer((request, response) => void this.#handle(request, response));
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
      throw new Error("Schedule MCP failed to bind a loopback port");
    }
    this.#server = server;
    server.unref();
    this.#origin = `http://127.0.0.1:${address.port}`;
  }

  descriptor(taskId: string): HttpMcpServer {
    if (!this.#origin) throw new Error("Schedule MCP has not started");
    return {
      id: "openma-schedules",
      type: "http",
      name: "OpenMA Schedules",
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
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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

const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("at"), at: z.string() }),
  z.object({ type: z.literal("interval"), everyMs: z.number().int().positive() }),
  z.object({
    type: z.literal("cron"),
    expression: z.string(),
    timezone: z.string(),
  }),
  z.object({
    type: z.literal("rrule"),
    rule: z.string(),
    timezone: z.string(),
  }),
]);

function createTaskMcpServer(taskId: string, tools: ScheduleHarnessToolTarget): McpServer {
  const server = new McpServer({ name: "openma-schedules", version: "1.0.0" });
  server.registerTool("schedule_create", {
    title: "Create schedule",
    description: "Create a one-time or recurring scheduled task using this task's harness and project.",
    inputSchema: {
      name: z.string().min(1),
      prompt: z.string().min(1),
      trigger: triggerSchema,
      target: z.enum(["current_task", "new_task"]).default("current_task"),
      notificationPolicy: z.enum(["always", "failures", "never"]).optional(),
    },
  }, async (input) => textResult(await tools.create(taskId, input as HarnessCreateScheduleInput)));
  server.registerTool("schedule_list", {
    title: "List schedules",
    description: "List schedules created by this task.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => textResult(await tools.list(taskId)));
  server.registerTool("schedule_update", {
    title: "Update schedule",
    description: "Update, pause, or resume one of this task's schedules.",
    inputSchema: {
      id: z.string(),
      name: z.string().min(1).optional(),
      prompt: z.string().min(1).optional(),
      trigger: triggerSchema.optional(),
      target: z.enum(["current_task", "new_task"]).optional(),
      status: z.enum(["active", "paused"]).optional(),
      notificationPolicy: z.enum(["always", "failures", "never"]).optional(),
    },
  }, async (input) => textResult(await tools.update(taskId, input as HarnessUpdateScheduleInput)));
  server.registerTool("schedule_delete", {
    title: "Delete schedule",
    description: "Delete one of this task's schedules and its run history.",
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    await tools.delete(taskId, id);
    return textResult({ deleted: true, id });
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
