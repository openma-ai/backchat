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

import { BrowserWindow, ipcMain, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { PushChannel, InvokeChannel } from "../shared/ipc-channels.js";
import type {
  AcpTerminalInfo,
  AcpTerminalSnapshot,
  ElicitationAskInfo,
  ElicitationFieldInfo,
  ElicitationFormRequestInfo,
  ElicitationFormResponseInfo,
  ElicitationResponseInfo,
  ElicitationUrlRequestInfo,
  ElicitationUrlResponseInfo,
  FsWriteAskInfo,
  PendingBrokerAskInfo,
  PermissionAskInfo,
} from "../shared/api.js";
import type { SessionEventOut } from "../shared/session-events.js";
import { permissionPresentationForHarness } from "./acp-client-callback-adapters.js";

// -------------------- Shared types -------------------------

interface PermissionDecision {
  requestId: string;
  optionId: string | null;
}

interface FsApprovalDecision {
  requestId: string;
  approved: boolean;
}

type ElicitationDecision = ElicitationResponseInfo & { requestId: string };

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

interface PendingElicitation {
  sessionId: string;
  ask: ElicitationAskInfo;
  resolve: (response: ElicitationResponseInfo) => void;
}

// -------------------- Pending registries -------------------------

const pendingPermission = new Map<string, PendingPermission>();
const pendingElicitation = new Map<string, PendingElicitation>();
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

let brokerSessionEventSink:
  | ((event: SessionEventOut) => void)
  | undefined;

/** Connect reverse-callback lifecycles to the ordinary session event sink.
 * The broker remains usable without a renderer (tests/headless consumers),
 * while the desktop wires this once during IPC startup. */
export function setBrokerSessionEventSink(
  sink: ((event: SessionEventOut) => void) | undefined,
): void {
  brokerSessionEventSink = sink;
}

// -------------------- Permission broker -------------------------

/** Called by AcpSessionImpl's Client.requestPermission. Returns the
 *  ACP-shaped RequestPermissionResponse once the user picks. */
export function requestPermission(
  sessionId: string,
  params: unknown,
  agentId?: string,
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
      presentation: permissionPresentationForHarness(agentId, p.toolCall),
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

export function requestElicitationForm(
  sessionId: string,
  request: ElicitationFormRequestInfo,
): Promise<ElicitationFormResponseInfo> {
  return new Promise((resolve) => {
    const requestId = makeRequestId("elicit");
    const ask: ElicitationAskInfo = {
      requestId,
      sessionId,
      message: request.message,
      fields: request.fields,
    };
    pendingElicitation.set(requestId, {
      sessionId,
      ask,
      resolve: (response) => resolve(response as ElicitationFormResponseInfo),
    });
    broadcast(PushChannel.ElicitationRequest, ask);
  });
}

export function requestElicitationUrl(
  sessionId: string,
  request: ElicitationUrlRequestInfo,
): Promise<ElicitationUrlResponseInfo> {
  return new Promise((resolve) => {
    const requestId = makeRequestId("elicit-url");
    const ask: ElicitationAskInfo = {
      requestId,
      sessionId,
      mode: "url",
      message: request.message,
      elicitationId: request.elicitationId,
      url: request.url,
    };
    pendingElicitation.set(requestId, { sessionId, ask, resolve });
    broadcast(PushChannel.ElicitationRequest, ask);
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
  sessionRoots: string | readonly string[],
  params: unknown,
): Promise<unknown> {
  const p = params as { path: string; content: string };
  const roots = typeof sessionRoots === "string" ? [sessionRoots] : sessionRoots;
  const insideCwd = roots.some((root) => isInsideCwd(p.path, root));
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
  command: string;
  args: string[];
  cwd: string;
  startedAt: number;
  proc: ChildProcessWithoutNullStreams;
  /** Rolling output buffer respecting outputByteLimit. */
  buf: string;
  byteLimit: number;
  exited: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  eventSeq: number;
  terminationReason?: "user_kill" | "released" | "session_disposed";
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
    command: p.command,
    args: [...(p.args ?? [])],
    cwd: p.cwd ?? sessionCwd,
    startedAt: Date.now(),
    proc,
    buf: "",
    byteLimit: p.outputByteLimit ?? 1_048_576,
    exited: false,
    exitCode: null,
    exitSignal: null,
    eventSeq: 0,
    waiters: [],
  };
  const emitLifecycle = (
    phase: Extract<SessionEventOut, { type: "session.background_process" }>["phase"],
    patch: Partial<Extract<SessionEventOut, { type: "session.background_process" }>> = {},
  ) => {
    brokerSessionEventSink?.({
      type: "session.background_process",
      session_id: sessionId,
      process_id: terminalId,
      seq: ++rec.eventSeq,
      phase,
      ...patch,
    });
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
    emitLifecycle("output", { output: text });
  };
  proc.stdout.on("data", appendChunk);
  proc.stderr.on("data", appendChunk);
  const settle = (
    code: number | null,
    signal: NodeJS.Signals | null,
    error?: string,
  ) => {
    if (rec.exited) return;
    rec.exited = true;
    rec.exitCode = code;
    rec.exitSignal = signal != null ? String(signal) : null;
    broadcast(PushChannel.TerminalExit, {
      sessionId,
      terminalId,
      exitCode: rec.exitCode,
      signal: rec.exitSignal,
      ...(rec.terminationReason
        ? { terminationReason: rec.terminationReason }
        : {}),
    });
    const outcome = {
      exit_code: rec.exitCode,
      signal: rec.exitSignal,
    };
    if (rec.terminationReason === "user_kill") {
      emitLifecycle("killed", { ...outcome, reason: "user_kill" });
    } else if (rec.terminationReason) {
      emitLifecycle("terminated", {
        ...outcome,
        reason: rec.terminationReason,
      });
    } else if (code === 0 && signal === null) {
      emitLifecycle("completed", outcome);
    } else if (signal !== null) {
      emitLifecycle("terminated", { ...outcome, reason: "process_signal" });
    } else {
      emitLifecycle("failed", { ...outcome, ...(error ? { error } : {}) });
    }
    for (const w of rec.waiters) {
      w({ exitCode: rec.exitCode, signal: rec.exitSignal });
    }
    rec.waiters = [];
  };
  proc.once("exit", settle);
  proc.once("error", (error) => settle(null, null, error.message));
  ptys.set(terminalId, rec);
  emitLifecycle("started", {
    command: rec.command,
    args: [...rec.args],
    cwd: rec.cwd,
  });
  return { terminalId };
}

function terminalInfo(terminalId: string, rec: PtyRecord): AcpTerminalInfo {
  return {
    sessionId: rec.sessionId,
    terminalId,
    command: rec.command,
    args: [...rec.args],
    cwd: rec.cwd,
    startedAt: rec.startedAt,
    exited: rec.exited,
    exitCode: rec.exitCode,
    signal: rec.exitSignal,
    ...(rec.terminationReason
      ? { terminationReason: rec.terminationReason }
      : {}),
  };
}

export function listTerminals(sessionId?: string): AcpTerminalInfo[] {
  return [...ptys.entries()]
    .filter(([, rec]) => !sessionId || rec.sessionId === sessionId)
    .map(([terminalId, rec]) => terminalInfo(terminalId, rec))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function terminalSnapshot(terminalId: string): AcpTerminalSnapshot | null {
  const rec = ptys.get(terminalId);
  if (!rec) return null;
  return {
    ...terminalInfo(terminalId, rec),
    output: rec.buf,
    truncated: rec.buf.length >= rec.byteLimit,
  };
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
  rec.terminationReason = "user_kill";
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
    if (!rec.exited) rec.terminationReason = "released";
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
  for (const [id, pending] of pendingElicitation) {
    if (pending.sessionId === sessionId) {
      pending.resolve({ action: "cancel" });
      pendingElicitation.delete(id);
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
      rec.terminationReason = "session_disposed";
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
      ...[...pendingElicitation.values()].map((pending) => ({
        kind: "elicitation" as const,
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
    brokerSessionEventSink?.({
      type: "session.permission_response",
      session_id: pending.sessionId,
      request_id: decision.requestId,
      option_id: decision.optionId,
      outcome: decision.optionId == null ? "cancelled" : "selected",
    });
    if (decision.optionId == null) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    } else {
      pending.resolve({
        outcome: { outcome: "selected", optionId: decision.optionId },
      });
    }
  });
  ipcMain.handle(InvokeChannel.ElicitationRespond, async (_e, decision: ElicitationDecision) => {
    const pending = pendingElicitation.get(decision.requestId);
    if (!pending) return;
    pendingElicitation.delete(decision.requestId);
    let response: ElicitationResponseInfo = pending.ask.mode === "url"
      ? validatedElicitationUrlResponse(decision)
      : validatedElicitationResponse(pending.ask.fields, decision);
    if (pending.ask.mode === "url" && response.action === "accept") {
      try {
        await shell.openExternal(pending.ask.url);
      } catch {
        response = { action: "decline" };
      }
    }
    brokerSessionEventSink?.({
      type: "session.elicitation_response",
      session_id: pending.sessionId,
      request_id: decision.requestId,
      action: response.action,
      ...(response.action === "accept" && "content" in response
        ? {
            content: response.content as Record<
              string,
              string | number | boolean | string[]
            >,
          }
        : {}),
      ...(pending.ask.mode === "url"
        ? {
            mode: "url" as const,
            elicitation_id: pending.ask.elicitationId,
          }
        : {}),
    });
    pending.resolve(response);
  });
  ipcMain.handle(
    InvokeChannel.FsApprovalRespond,
    async (_e, decision: FsApprovalDecision) => {
      const pending = pendingFsWrite.get(decision.requestId);
      if (!pending) return;
      pendingFsWrite.delete(decision.requestId);
      brokerSessionEventSink?.({
        type: "session.fs_write_response",
        session_id: pending.sessionId,
        request_id: decision.requestId,
        path: pending.path,
        outcome: decision.approved ? "allowed" : "denied",
      });
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

function validatedElicitationResponse(
  fields: readonly ElicitationFieldInfo[],
  decision: ElicitationDecision,
): ElicitationFormResponseInfo {
  if (decision.action === "decline" || decision.action === "cancel") {
    return { action: decision.action };
  }
  if (decision.action !== "accept") return { action: "decline" };
  if (!("content" in decision) || !decision.content || typeof decision.content !== "object") {
    return { action: "decline" };
  }
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const field of fields) {
    const value = decision.content[field.name];
    if (value === undefined) {
      if (field.required) return { action: "decline" };
      continue;
    }
    if (!validElicitationFieldValue(field, value)) return { action: "decline" };
    content[field.name] = value;
  }
  return { action: "accept", content };
}

function validatedElicitationUrlResponse(
  decision: ElicitationDecision,
): ElicitationUrlResponseInfo {
  if (decision.action === "accept") return { action: "accept" };
  if (decision.action === "cancel") return { action: "cancel" };
  return { action: "decline" };
}

function validElicitationFieldValue(
  field: ElicitationFieldInfo,
  value: string | number | boolean | string[],
): boolean {
  if (field.type === "text") {
    if (typeof value !== "string") return false;
    if (field.minLength !== undefined && value.length < field.minLength) return false;
    if (field.maxLength !== undefined && value.length > field.maxLength) return false;
    if (field.pattern) {
      try {
        if (!new RegExp(field.pattern).test(value)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  if (field.type === "number") {
    return typeof value === "number"
      && Number.isFinite(value)
      && (!field.integer || Number.isInteger(value))
      && (field.minimum === undefined || value >= field.minimum)
      && (field.maximum === undefined || value <= field.maximum);
  }
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "select") {
    return typeof value === "string"
      && field.options.some((option) => option.value === value);
  }
  return Array.isArray(value)
    && value.every((item) =>
      typeof item === "string"
      && field.options.some((option) => option.value === item))
    && (field.minItems === undefined || value.length >= field.minItems)
    && (field.maxItems === undefined || value.length <= field.maxItems);
}
