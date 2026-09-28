import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { makeProjectMcpServer } from "@openmatter/project-mcp";
import { projectStatus } from "@openmatter/project-host";
import { Effect } from "effect";
import type { ProjectWorkService } from "./project-work.js";
import type { ProjectAgentBridge } from "./project-agent.js";
import type { SettingsMcpServer } from "../shared/settings.js";

/** Authenticated loopback transport for the SDK's existing project tool binding. */
export class ProjectMcpBridge {
  #server?: Server;
  #origin = "";
  readonly #tokens = new Map<string, string>();
  readonly #sessions = new Map<string, {
    readonly server: ReturnType<typeof makeProjectMcpServer>;
    readonly transport: StreamableHTTPServerTransport;
  }>();
  constructor(
    readonly service: ProjectWorkService,
    readonly agents: ProjectAgentBridge,
  ) {}
  async start() {
    this.#server = createServer((req, res) => {
      void (async () => {
        const sessionId = decodeURIComponent(
          new URL(req.url ?? "/", "http://127.0.0.1").pathname.slice(1),
        );
        const binding = this.agents.bindings.get(sessionId);
        const token = this.#tokens.get(sessionId);
        if (
          !binding ||
          !token ||
          req.headers.authorization !== `Bearer ${token}`
        ) {
          res.writeHead(401).end();
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 128_000) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const control = () => {
          const live = this.agents.bindings.get(sessionId)!;
          return this.service.control(live.projectId, live.runId);
        };
        let session = this.#sessions.get(sessionId);
        if (!session) {
          const mcp = makeProjectMcpServer({
            goal: this.service.goalControl(binding.projectId, binding.workThreadId),
            ...(binding.role === "coordinator" ? {
              tools: this.service.config(binding.projectId)?.controls ?? [],
              readStatus: async (query: Parameters<typeof projectStatus>[1]) =>
                projectStatus(await this.service.view(binding.projectId), query),
              control: {
                delegate: (p) => Effect.suspend(() => control().delegate(p)),
                steer: (p) => Effect.suspend(() => control().steer(p)),
                cancel: (p) => Effect.suspend(() => control().cancel(p)),
                complete: (p) => Effect.suspend(() => control().complete(p)),
              },
            } : { tools: [] }),
          });
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId,
          });
          await mcp.connect(transport);
          session = { server: mcp, transport };
          this.#sessions.set(sessionId, session);
        }
        // The authenticated URL already identifies the WorkThread session. The
        // SDK's stateful transport also requires this header on follow-up calls.
        if (!req.headers["mcp-session-id"]) {
          req.headers["mcp-session-id"] = sessionId;
          req.rawHeaders.push("Mcp-Session-Id", sessionId);
        }
        try {
          await session.transport.handleRequest(req, res, body);
        } catch (error) {
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        }
      })().catch((error) => {
        if (!res.headersSent)
          res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.#server!.once("error", reject);
      this.#server!.listen(0, "127.0.0.1", resolve);
    });
    const address = this.#server.address();
    if (!address || typeof address === "string")
      throw new Error("Project MCP did not bind");
    this.#origin = `http://127.0.0.1:${address.port}`;
    this.#server.unref();
  }
  descriptor(sessionId: string): SettingsMcpServer | undefined {
    const binding = this.agents.bindings.get(sessionId);
    if (!binding?.workThreadId || !this.#origin)
      return undefined;
    let token = this.#tokens.get(sessionId);
    if (!token) {
      token = randomBytes(32).toString("hex");
      this.#tokens.set(sessionId, token);
    }
    return {
      id: "openmatter-project",
      name: "Project",
      type: "http",
      url: `${this.#origin}/${encodeURIComponent(sessionId)}`,
      headers: [{ name: "Authorization", value: `Bearer ${token}` }],
    };
  }
  async close() {
    for (const session of this.#sessions.values()) {
      await session.transport.close().catch(() => undefined);
      await session.server.close().catch(() => undefined);
    }
    this.#sessions.clear();
    const server = this.#server;
    if (server) {
      this.#server = undefined;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
