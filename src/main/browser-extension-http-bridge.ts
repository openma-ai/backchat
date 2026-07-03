import http, { type IncomingMessage, type ServerResponse } from "node:http";

import type {
  ChromeExtensionBridge,
  ChromeExtensionBridgeCommand,
  ChromeExtensionBridgeHealth,
  ChromeExtensionRegistration,
} from "./browser-plugin-extension-adapter.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_COMMAND_LONG_POLL_MS = 25_000;
const REQUEST_BODY_TIMEOUT_MS = 5_000;
const CORS_HEADERS = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-allow-private-network": "true",
};

interface PendingCommand {
  command: ChromeExtensionBridgeCommand;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface WaitingPoll {
  instanceId: string;
  response: ServerResponse;
  timeout: NodeJS.Timeout;
}

export interface ChromeExtensionHttpBridgeServer {
  url: string;
  bridge: ChromeExtensionBridge;
  close(): Promise<void>;
}

export async function createChromeExtensionHttpBridge(options: {
  preferredPort?: number;
  commandTimeoutMs?: number;
  commandLongPollMs?: number;
} = {}): Promise<ChromeExtensionHttpBridgeServer> {
  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const commandLongPollMs = options.commandLongPollMs ?? DEFAULT_COMMAND_LONG_POLL_MS;
  let registration: ChromeExtensionRegistration | null = null;
  const health: Omit<ChromeExtensionBridgeHealth, "pendingCommandCount" | "queuedCommandCount"> = {
    status: "disconnected",
  };
  const queue: ChromeExtensionBridgeCommand[] = [];
  const pending = new Map<string, PendingCommand>();
  const waitingPolls = new Set<WaitingPoll>();

  const bridge: ChromeExtensionBridge = {
    get registration() {
      return registration;
    },
    get health() {
      return {
        ...health,
        pendingCommandCount: pending.size,
        queuedCommandCount: queue.length,
      };
    },
    async sendCommand(command) {
      if (!registration) {
        const error = new Error("Chrome extension bridge is not connected");
        health.status = "disconnected";
        health.lastError = error.message;
        throw error;
      }
      health.status = "connected";
      health.lastCommandAt = new Date().toISOString();
      health.lastCommandType = command.type;
      queue.push(command);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(command.id);
          const queuedIndex = queue.findIndex((item) => item.id === command.id);
          if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
          const error = new Error(`Chrome extension command timed out: ${command.type}`);
          health.status = "command-timeout";
          health.lastError = error.message;
          reject(error);
        }, commandTimeoutMs);
        pending.set(command.id, { command, resolve, reject, timeout });
        flushWaitingPolls({
          get registration() {
            return registration;
          },
          queue,
          waitingPolls,
        });
      });
    },
  };

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, {
      get registration() {
        return registration;
      },
      setRegistration(value) {
        registration = value;
        health.status = "connected";
        health.lastConnectedAt = new Date().toISOString();
        delete health.lastError;
      },
      health,
      queue,
      pending,
      waitingPolls,
      commandLongPollMs,
    }).catch((error) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      writeText(response, 400, error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.preferredPort ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeHttpServer(server);
    throw new Error("Chrome extension bridge did not bind a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    bridge,
    close: async () => {
      for (const waiter of waitingPolls) {
        clearTimeout(waiter.timeout);
        writeText(waiter.response, 204, "");
      }
      waitingPolls.clear();
      await closeHttpServer(server);
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: {
    registration: ChromeExtensionRegistration | null;
    setRegistration(value: ChromeExtensionRegistration): void;
    health: Omit<ChromeExtensionBridgeHealth, "pendingCommandCount" | "queuedCommandCount">;
    queue: ChromeExtensionBridgeCommand[];
    pending: Map<string, PendingCommand>;
    waitingPolls: Set<WaitingPoll>;
    commandLongPollMs: number;
  },
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "OPTIONS") {
    writeNoContent(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/register") {
    await nextTick();
    const payload = await readJson(request);
    state.setRegistration(readRegistration(payload));
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/commands/next") {
    const instanceId = url.searchParams.get("instanceId");
    if (!state.registration || state.registration.instanceId !== instanceId) {
      writeText(response, 404, "extension is not registered");
      return;
    }
    const command = state.queue.shift();
    if (!command) {
      const waiter: WaitingPoll = {
        instanceId,
        response,
        timeout: setTimeout(() => {
          state.waitingPolls.delete(waiter);
          writeText(response, 204, "");
        }, state.commandLongPollMs),
      };
      state.waitingPolls.add(waiter);
      request.once("close", () => {
        clearTimeout(waiter.timeout);
        state.waitingPolls.delete(waiter);
      });
      return;
    }
    writeJson(response, 200, command);
    return;
  }

  if (request.method === "POST" && url.pathname === "/commands/result") {
    await nextTick();
    const payload = readResult(await readJson(request));
    if (!state.registration || state.registration.instanceId !== payload.instanceId) {
      writeText(response, 404, "extension is not registered");
      return;
    }
    const pending = state.pending.get(payload.id);
    if (!pending) {
      writeText(response, 404, "command is not pending");
      return;
    }
    clearTimeout(pending.timeout);
    state.pending.delete(payload.id);
    if (payload.ok) {
      state.health.status = "connected";
      delete state.health.lastError;
      pending.resolve(payload.result);
    } else {
      const error = new Error(payload.error ?? "Chrome extension command failed");
      state.health.status = "command-error";
      state.health.lastError = error.message;
      pending.reject(error);
    }
    writeJson(response, 200, { ok: true });
    return;
  }

  writeText(response, 404, "not found");
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function flushWaitingPolls(state: {
  registration: ChromeExtensionRegistration | null;
  queue: ChromeExtensionBridgeCommand[];
  waitingPolls: Set<WaitingPoll>;
}): void {
  if (!state.registration) return;
  for (const waiter of [...state.waitingPolls]) {
    if (waiter.instanceId !== state.registration.instanceId) continue;
    const command = state.queue.shift();
    if (!command) return;
    clearTimeout(waiter.timeout);
    state.waitingPolls.delete(waiter);
    writeJson(waiter.response, 200, command);
  }
}

function readRegistration(value: unknown): ChromeExtensionRegistration {
  const record = readRecord(value, "registration payload");
  return {
    extensionId: readString(record, "extensionId"),
    extensionVersion: readString(record, "extensionVersion"),
    instanceId: readString(record, "instanceId"),
    ...(typeof record.profileName === "string" ? { profileName: record.profileName } : {}),
  };
}

function readResult(value: unknown): {
  instanceId: string;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
} {
  const record = readRecord(value, "command result");
  return {
    instanceId: readString(record, "instanceId"),
    id: readString(record, "id"),
    ok: record.ok === true,
    result: record.result,
    ...(typeof record.error === "string" ? { error: record.error } : {}),
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  if (typeof record[key] !== "string" || record[key] === "") {
    throw new Error(`${key} is required`);
  }
  return record[key];
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("request body timed out"));
    }, REQUEST_BODY_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    };
    const onData = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...CORS_HEADERS, "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function writeText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { ...CORS_HEADERS, "content-type": "text/plain" });
  response.end(body);
}

function writeNoContent(response: ServerResponse): void {
  response.writeHead(204, CORS_HEADERS);
  response.end();
}

function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
