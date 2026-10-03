import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { dirname } from "node:path";
import type { ControlErrorCode } from "../../shared/control-protocol.js";
import { ControlError, asControlError } from "./errors.js";
import type { ControlApi } from "./handlers.js";

const MAX_BODY = 1024 * 1024;

export interface ControlServer {
  socketPath: string;
  /** A filesystem path or named pipe. Never a TCP port. */
  address: string | null;
  close(): Promise<void>;
}

export async function startControlServer(options: {
  socketPath: string;
  api: ControlApi;
  uid?: number;
}): Promise<ControlServer> {
  const uid = options.uid ?? process.getuid?.();
  if (process.platform !== "win32") {
    await mkdir(dirname(options.socketPath), { recursive: true, mode: 0o700 });
    await claimSocket(options.socketPath);
  }

  const server = createServer((req, res) => {
    void handle(req, res, options.api, options.socketPath, uid).catch((error) => {
      if (!res.headersSent) writeJson(res, 500, failure("error", error instanceof Error ? error.message : String(error)));
      else res.destroy();
    });
  });

  await listen(server, options.socketPath);
  if (process.platform !== "win32") {
    await chmod(options.socketPath, 0o600);
  }
  server.unref();

  const bound = server.address();
  return {
    socketPath: options.socketPath,
    address: typeof bound === "string" ? bound : null,
    close: async () => {
      await closeServer(server);
      if (process.platform !== "win32") {
        await rm(options.socketPath, { force: true });
      }
    },
  };
}

async function claimSocket(socketPath: string): Promise<void> {
  try {
    await stat(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const alive = await new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
  if (alive) {
    throw new ControlError("error", `Control server is already listening on ${socketPath}`);
  }
  await rm(socketPath, { force: true });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  api: ControlApi,
  socketPath: string,
  uid: number | undefined,
): Promise<void> {
  if (rejectForeignPeer(req.socket, uid)) {
    writeJson(res, 403, failure("error", "Control socket requests must come from the Backchat user"));
    return;
  }
  if (process.platform !== "win32" && !(await socketIsOwnerOnly(socketPath, uid))) {
    writeJson(res, 403, failure("error", "Control socket is not owner-only"));
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    writeJson(res, 200, { ok: true, transport: process.platform === "win32" ? "pipe" : "unix" });
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/v1/call") {
    writeJson(res, 404, failure("not_found", "Unknown control route"));
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    writeJson(res, 400, failure("invalid_args", error instanceof Error ? error.message : "Invalid JSON"));
    return;
  }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const method = typeof record.method === "string" ? record.method : "";
  if (!method) {
    writeJson(res, 400, failure("invalid_args", "method is required"));
    return;
  }
  try {
    const result = await api.call(method, record.params ?? {});
    writeJson(res, 200, { ok: true, result });
  } catch (error) {
    const control = asControlError(error);
    writeJson(res, httpStatus(control.code), {
      ok: false,
      error: { code: control.code, message: control.message },
      ...(control.data !== undefined ? { result: control.data } : {}),
    });
  }
}

function rejectForeignPeer(socket: Socket, uid: number | undefined): boolean {
  if (uid === undefined) return false;
  const peer = peerUid(socket);
  return peer !== null && peer !== uid;
}

function peerUid(socket: Socket): number | null {
  const handle = (socket as Socket & {
    _handle?: { getPeerUid?: () => number; getpeeruid?: () => number };
  })._handle;
  const reader = handle?.getPeerUid ?? handle?.getpeeruid;
  if (typeof reader !== "function") return null;
  try {
    const uid = reader.call(handle);
    return typeof uid === "number" ? uid : null;
  } catch {
    return null;
  }
}

async function socketIsOwnerOnly(socketPath: string, uid: number | undefined): Promise<boolean> {
  try {
    const info = await stat(socketPath);
    if ((info.mode & 0o777) !== 0o600) return false;
    if (uid !== undefined && typeof info.uid === "number" && info.uid !== uid) return false;
    return true;
  } catch {
    return false;
  }
}

function httpStatus(code: ControlErrorCode): number {
  switch (code) {
    case "invalid_args":
      return 400;
    case "not_found":
      return 404;
    case "timeout":
      return 408;
    default:
      return 500;
  }
}

function failure(code: ControlErrorCode, message: string) {
  return { ok: false, error: { code, message } };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ControlError("invalid_args", "Control request is too large"));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
