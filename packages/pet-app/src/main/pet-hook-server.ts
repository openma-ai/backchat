import { createServer, type Server } from "node:http";

export const PET_HOOK_PORT = 47632;

export type PetHookEvent = {
  harness: string;
  event: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  agentId?: string;
  label?: string;
  payload?: unknown;
};

export type PetAckEvent = {
  harness: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  reason?: string;
};

export type PetHookServer = {
  port: number;
  close(): Promise<void>;
};

export async function startPetHookServer(options: {
  port?: number;
  onEvent(event: PetHookEvent): void;
  onAck?(event: PetAckEvent): void;
}): Promise<PetHookServer> {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/hook")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        ok: true,
        endpoint: "/hook",
        ackEndpoint: "/ack",
        example: {
          harness: "codex",
          event: "task.completed",
          threadId: "019ecf32-f48f-7371-96f9-c6802555aeea",
          label: "Done",
        },
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/hook") {
      try {
        const body = await readBody(req);
        const event = JSON.parse(body) as unknown;
        if (!isPetHookEvent(event)) {
          res.writeHead(400).end("invalid pet hook event");
          return;
        }
        options.onEvent(event);
        res.writeHead(204).end();
      } catch (error) {
        res.writeHead(400).end(String(error));
      }
      return;
    }
    if (req.method === "POST" && req.url === "/ack") {
      try {
        const body = await readBody(req);
        const event = JSON.parse(body) as unknown;
        if (!isPetAckEvent(event)) {
          res.writeHead(400).end("invalid pet ack event");
          return;
        }
        options.onAck?.(event);
        res.writeHead(204).end();
      } catch (error) {
        res.writeHead(400).end(String(error));
      }
      return;
    }
    res.writeHead(404).end();
  });

  await listen(server, options.port ?? PET_HOOK_PORT);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port ?? PET_HOOK_PORT;
  return {
    port,
    close: () => close(server),
  };
}

function isPetHookEvent(value: unknown): value is PetHookEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["harness"] === "string" && typeof record["event"] === "string";
}

function isPetAckEvent(value: unknown): value is PetAckEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["harness"] === "string" &&
    (typeof record["sessionId"] === "string" || typeof record["threadId"] === "string");
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error("pet hook payload too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
