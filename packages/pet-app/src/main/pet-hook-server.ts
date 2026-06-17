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

export type PetHookServer = {
  port: number;
  close(): Promise<void>;
};

export async function startPetHookServer(options: {
  port?: number;
  onEvent(event: PetHookEvent): void;
}): Promise<PetHookServer> {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/hook")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        ok: true,
        endpoint: "/hook",
        example: {
          harness: "codex",
          event: "task.completed",
          threadId: "thread-1",
          label: "Done",
        },
      }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/hook") {
      res.writeHead(404).end();
      return;
    }
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
