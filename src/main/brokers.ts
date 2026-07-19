/**
 * Brokers — main-process bridges between ACP client callbacks and the
 * renderer UI. ACP fires `requestPermission`, `readTextFile`,
 * `writeTextFile`, and the `terminal/*` family as synchronous request →
 * response. The agent waits for the response; the renderer is the only
 * one that knows what the user wants. These brokers ferry the request to
 * the renderer over IPC, wait for the user's decision, and unblock the
 * agent's promise.
 *
 * Same shape across all three:
 *   1. ACP callback fires in main → store {resolve, reject} in a Map by
 *      requestId, push 'kind:request' to all open windows.
 *   2. Renderer shows a modal; user picks; IPC invoke fires
 *      'kind:respond' with {requestId, decision}.
 *   3. Main looks up pending entry, calls resolve with the ACP-shaped
 *      response, deletes from Map. Agent's await resolves and the
 *      tool call continues.
 *
 * Cancellation: SessionManager calls `cancelPendingFor(sessionId)` on
 * dispose / drain; pending entries reject with the appropriate ACP
 * "cancelled" shape so the agent unwinds cleanly.
 */

import { BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { PushChannel, InvokeChannel } from "../shared/ipc-channels.js";
import type {
  FsWriteAskInfo,
  PendingBrokerAskInfo,
  PermissionAskInfo,
} from "../shared/api.js";

// -------------------- Shared types -------------------------

interface PermissionDecision {
  requestId: string;
  optionId: string | null;
}

interface FsApprovalDecision {
  requestId: string;
  approved: boolean;
}

interface PendingPermission {
  sessionId: string;
  ask: PermissionAskInfo;
  resolve: (
    decision: { outcome: { outcome: "selected"; optionId: string } } |
              { outcome: { outcome: "cancelled" } },
  ) => void;
}

interface PendingFsWrite {
  sessionId: string;
  ask: FsWriteAskInfo;
  path: string;
  content: string;
  resolve: (v: Record<string, never>) => void;
  reject: (e: Error) => void;
}

// -------------------- Pending registries -------------------------

const pendingPermission = new Map<string, PendingPermission>();
const pendingFsWrite = new Map<string, PendingFsWrite>();
let nextRequestId = 1;
function makeRequestId(prefix: string): string {
  return `${prefix}-${nextRequestId++}-${Math.random().toString(36).slice(2, 8)}`;
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

// -------------------- Permission broker -------------------------

/** Called by AcpSessionImpl's Client.requestPermission. Returns the
 *  ACP-shaped RequestPermissionResponse once the user picks. */
export function requestPermission(
  sessionId: string,
  params: unknown,
): Promise<unknown> {
  const p = params as {
    options: Array<{ optionId: string; name: string; kind: string }>;
    toolCall: unknown;
  };
  return new Promise((resolve) => {
    const requestId = makeRequestId("perm");
    const ask: PermissionAskInfo = {
      requestId,
      sessionId,
      toolCall: p.toolCall,
      options: p.options as PermissionAskInfo["options"],
    };
    pendingPermission.set(requestId, {
      sessionId,
      ask,
      resolve: (d) => resolve(d),
    });
    broadcast(PushChannel.PermissionRequest, ask);
  });
}

// -------------------- FS broker -------------------------

/** Reads a UTF-8 file. ACP doesn't define a "deny" surface for reads —
 *  if the agent asks, we read. (Threat model: an agent that asks for
 *  /etc/passwd is already running in your shell; we're not the security
 *  boundary.) Line + limit slicing per ACP shape. */
export async function readTextFile(params: unknown): Promise<unknown> {
  const p = params as { path: string; line?: number | null; limit?: number | null };
  const text = await readFile(p.path, "utf-8");
  if (p.line == null && p.limit == null) return { content: text };
  const lines = text.split("\n");
  const start = Math.max(0, (p.line ?? 1) - 1);
  const end = p.limit != null ? Math.min(lines.length, start + p.limit) : lines.length;
  return { content: lines.slice(start, end).join("\n") };
}

/** Writes a UTF-8 file. Approval policy:
 *    - inside session cwd → silent allow
 *    - outside session cwd → push approval modal, await user
 *  Approval also surfaces a small diff preview for the modal.
 */
export function writeTextFile(
  sessionId: string,
  sessionCwd: string,
  params: unknown,
): Promise<unknown> {
  const p = params as { path: string; content: string };
  const insideCwd = isInsideCwd(p.path, sessionCwd);
  return new Promise(async (resolve, reject) => {
    if (insideCwd) {
      try {
        await mkdir(dirname(p.path), { recursive: true });
        await writeFile(p.path, p.content, "utf-8");
        resolve({});
      } catch (e) {
        reject(e as Error);
      }
      return;
    }
    // Outside cwd — needs approval.
    const requestId = makeRequestId("fsw");
    const oldPreview = await readFile(p.path, "utf-8").catch(() => "");
    const ask: FsWriteAskInfo = {
      requestId,
      sessionId,
      path: p.path,
      byteSize: p.content.length,
      newPreview: p.content.slice(0, 1024),
      oldPreview: oldPreview.slice(0, 1024),
    };
    pendingFsWrite.set(requestId, {
      sessionId,
      ask,
      path: p.path,
      content: p.content,
      resolve: (v) => resolve(v),
      reject,
    });
    broadcast(PushChannel.FsWriteApproval, ask);
  });
}

function isInsideCwd(target: string, cwd: string): boolean {
  if (!isAbsolute(target) || !cwd) return false;
  const resolved = resolvePath(target);
  const root = resolvePath(cwd) + "/";
  return resolved === resolvePath(cwd) || resolved.startsWith(root);
}

// -------------------- Terminal broker -------------------------
//
// We don't ship node-pty. Its native ABI lags Electron's bleeding V8/Node
// (same problem better-sqlite3 has — V8 14 is too new). ACP terminals are
// command-runners, not curses apps; child_process.spawn with stdio:'pipe'
// gives us stdout + stderr streams + exit code, which is what the agent
// actually needs. If a future agent wants a real pty (interactive top /
// vim / etc.) we'll revisit when node-pty catches up or the @lydell/node-
// pty fork stabilizes.

interface PtyRecord {
  sessionId: string;
  proc: ChildProcessWithoutNullStreams;
  /** Rolling output buffer respecting outputByteLimit. */
  buf: string;
  byteLimit: number;
  exited: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  /** Promise resolvers for in-flight waitForTerminalExit. */
  waiters: Array<(v: { exitCode: number | null; signal: string | null }) => void>;
}

const ptys = new Map<string, PtyRecord>();
let nextTerminalId = 1;

export function createTerminal(
  sessionId: string,
  sessionCwd: string,
  params: unknown,
): { terminalId: string } {
  const p = params as {
    command: string;
    args?: string[];
    cwd?: string | null;
    env?: Array<{ name: string; value: string }>;
    outputByteLimit?: number | null;
  };
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const e of p.env ?? []) env[e.name] = e.value;
  const proc = spawn(p.command, p.args ?? [], {
    cwd: p.cwd ?? sessionCwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const terminalId = `term-${nextTerminalId++}-${Math.random().toString(36).slice(2, 6)}`;
  const rec: PtyRecord = {
    sessionId,
    proc,
    buf: "",
    byteLimit: p.outputByteLimit ?? 1_048_576,
    exited: false,
    exitCode: null,
    exitSignal: null,
    waiters: [],
  };
  const appendChunk = (data: Buffer | string) => {
    const text = typeof data === "string" ? data : data.toString("utf-8");
    rec.buf += text;
    if (rec.buf.length > rec.byteLimit) {
      // Truncate from the start at a char boundary. Strings in JS are
      // UTF-16 code units, so slicing into the middle of a surrogate
      // pair would emit replacement chars; rewind one if we landed on
      // a low surrogate.
      let cut = rec.buf.length - rec.byteLimit;
      const code = rec.buf.charCodeAt(cut);
      if (code >= 0xdc00 && code <= 0xdfff) cut += 1;
      rec.buf = rec.buf.slice(cut);
    }
    broadcast(PushChannel.TerminalOutput, { sessionId, terminalId, chunk: text });
  };
  proc.stdout.on("data", appendChunk);
  proc.stderr.on("data", appendChunk);
  const settle = (code: number | null, signal: NodeJS.Signals | null) => {
    if (rec.exited) return;
    rec.exited = true;
    rec.exitCode = code;
    rec.exitSignal = signal != null ? String(signal) : null;
    broadcast(PushChannel.TerminalExit, {
      sessionId,
      terminalId,
      exitCode: rec.exitCode,
      signal: rec.exitSignal,
    });
    for (const w of rec.waiters) {
      w({ exitCode: rec.exitCode, signal: rec.exitSignal });
    }
    rec.waiters = [];
  };
  proc.once("exit", settle);
  proc.once("error", () => settle(null, null));
  ptys.set(terminalId, rec);
  return { terminalId };
}

export function terminalOutput(params: unknown): unknown {
  const p = params as { terminalId: string };
  const rec = ptys.get(p.terminalId);
  if (!rec) return { output: "", truncated: false };
  return {
    output: rec.buf,
    truncated: rec.buf.length >= rec.byteLimit,
    exitStatus: rec.exited
      ? { exitCode: rec.exitCode, signal: rec.exitSignal }
      : null,
  };
}

export function waitForTerminalExit(params: unknown): Promise<unknown> {
  const p = params as { terminalId: string };
  const rec = ptys.get(p.terminalId);
  if (!rec) return Promise.resolve({ exitCode: null, signal: null });
  if (rec.exited) {
    return Promise.resolve({ exitCode: rec.exitCode, signal: rec.exitSignal });
  }
  return new Promise((resolve) => {
    rec.waiters.push((r) => resolve(r));
  });
}

export function killTerminal(params: unknown): void {
  const p = params as { terminalId: string };
  const rec = ptys.get(p.terminalId);
  if (!rec || rec.exited) return;
  try {
    rec.proc.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

export function releaseTerminal(params: unknown): void {
  const p = params as { terminalId: string };
  const rec = ptys.get(p.terminalId);
  if (rec) {
    try {
      rec.proc.kill("SIGTERM");
    } catch { /* gone */ }
    ptys.delete(p.terminalId);
  }
}

// -------------------- Per-session cancellation -------------------------

/** SessionManager calls this on dispose to unwind pending requests. */
export function cancelPendingFor(sessionId: string): void {
  for (const [id, p] of pendingPermission) {
    if (p.sessionId === sessionId) {
      p.resolve({ outcome: { outcome: "cancelled" } });
      pendingPermission.delete(id);
    }
  }
  for (const [id, p] of pendingFsWrite) {
    if (p.sessionId === sessionId) {
      p.reject(new Error("session disposed"));
      pendingFsWrite.delete(id);
    }
  }
  for (const [id, rec] of ptys) {
    if (rec.sessionId === sessionId) {
      try { rec.proc.kill("SIGTERM"); } catch { /* gone */ }
      ptys.delete(id);
    }
  }
}

// -------------------- IPC registration -------------------------

export function registerBrokers(): void {
  ipcMain.handle(
    InvokeChannel.BrokerPendingAsks,
    (): PendingBrokerAskInfo[] => [
      ...[...pendingPermission.values()].map((pending) => ({
        kind: "permission" as const,
        ask: pending.ask,
      })),
      ...[...pendingFsWrite.values()].map((pending) => ({
        kind: "fsWrite" as const,
        ask: pending.ask,
      })),
    ],
  );
  ipcMain.handle(InvokeChannel.PermissionRespond, (_e, decision: PermissionDecision) => {
    const pending = pendingPermission.get(decision.requestId);
    if (!pending) return;
    pendingPermission.delete(decision.requestId);
    if (decision.optionId == null) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    } else {
      pending.resolve({
        outcome: { outcome: "selected", optionId: decision.optionId },
      });
    }
  });
  ipcMain.handle(
    InvokeChannel.FsApprovalRespond,
    async (_e, decision: FsApprovalDecision) => {
      const pending = pendingFsWrite.get(decision.requestId);
      if (!pending) return;
      pendingFsWrite.delete(decision.requestId);
      if (!decision.approved) {
        pending.reject(new Error("user denied write"));
        return;
      }
      try {
        await mkdir(dirname(pending.path), { recursive: true });
        await writeFile(pending.path, pending.content, "utf-8");
        pending.resolve({});
      } catch (e) {
        pending.reject(e as Error);
      }
    },
  );
}
