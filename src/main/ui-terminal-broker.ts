/**
 * UI terminal broker — pty-backed shells shown in the bottom panel.
 *
 * Distinct from `brokers.ts` terminal/* family: that one is
 * `child_process.spawn` for ACP-driven command runs (non-interactive).
 * This one is a real PTY for the user's hand-typed shell. Different
 * users, different lifecycle, different IPC channels — see
 * shared/ipc-channels.ts UiTerm* / shared/api.ts uiTerm*.
 *
 * Performance shape (informed by VS Code / Tabby's terminal layers):
 *
 *   1. PTY → 16 ms-coalesced IPC. Each pty `onData` appends to a per-
 *      terminal pending buffer; an unref'd timer flushes once per
 *      animation frame. Without this, a fast process like `cat 100MB
 *      file` fires thousands of `webContents.send` per second and the
 *      v8 structured-clone cost alone tanks the renderer.
 *
 *   2. Backpressure. When the pending buffer exceeds HIGH_WATER, we
 *      `pty.pause()` until the renderer's last ack drains it below
 *      LOW_WATER, then `pty.resume()`. Without this, a misbehaving
 *      child can balloon RSS by gigabytes before xterm.js even paints
 *      the first frame.
 *
 *   3. UTF-8 boundary safety. node-pty emits Latin-1 strings (raw byte
 *      view) when its `encoding` is set to null. We instead let
 *      node-pty default to utf8 — its native side handles partial
 *      multibyte sequences (waits for the trailing bytes before
 *      surfacing the chunk). One less moving part.
 */

import { BrowserWindow, ipcMain } from "electron";
import { homedir } from "node:os";
import { spawn as ptySpawn, type IPty } from "node-pty";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";

interface TermRecord {
  id: string;
  pty: IPty;
  /** Owner window — we only push data back to the window that spawned
   *  the term. Prevents cross-window leakage if Phase 9 ever lights up
   *  multiple windows. */
  ownerWebContentsId: number;
  /** Pending data not yet flushed to the renderer. Coalesced per frame. */
  pending: string;
  /** Total bytes pending — drives the pause/resume watermark logic. */
  pendingBytes: number;
  /** Set when pty.pause() is in effect. */
  paused: boolean;
  /** Active flush timer id, or null if no flush is queued. */
  flushTimer: NodeJS.Timeout | null;
  /** Last reported window size. We don't re-emit a resize that matches
   *  the last one — xterm.js's fit addon can fire identical resizes on
   *  every render. */
  lastCols: number;
  lastRows: number;
}

const terms = new Map<string, TermRecord>();
let nextId = 1;

/** Coalescing window. 16 ms matches a 60-Hz frame; on faster displays
 *  the flush still feels instant because xterm.js's own renderer ticks
 *  at refresh rate anyway. */
const FLUSH_MS = 16;
/** ~64 KB pending → start back-pressuring. Tabby uses 100 KB; VS Code
 *  uses ~40 KB. 64 KB is a deliberate middle: small enough to keep
 *  perceptible latency bounded, large enough that a normal `ls` /
 *  `git log` never trips it. */
const HIGH_WATER = 64 * 1024;
/** Resume threshold — hysteresis so we don't oscillate. */
const LOW_WATER = 16 * 1024;

function pushToOwner(rec: TermRecord, channel: string, payload: unknown): void {
  // BrowserWindow.fromWebContents is the explicit per-window lookup —
  // re-resolves the window every flush so a window that closed mid-
  // stream silently stops receiving (we tear the term down in onExit
  // anyway; this is the belt to that suspender).
  const all = BrowserWindow.getAllWindows();
  for (const w of all) {
    if (w.isDestroyed()) continue;
    if (w.webContents.id !== rec.ownerWebContentsId) continue;
    w.webContents.send(channel, payload);
    return;
  }
}

function scheduleFlush(rec: TermRecord): void {
  if (rec.flushTimer) return;
  rec.flushTimer = setTimeout(() => {
    rec.flushTimer = null;
    flushNow(rec);
  }, FLUSH_MS);
  // Unref so a hanging flush doesn't keep the event loop alive when
  // the rest of the process wants to exit.
  rec.flushTimer.unref?.();
}

function flushNow(rec: TermRecord): void {
  if (!rec.pending) return;
  const data = rec.pending;
  rec.pending = "";
  rec.pendingBytes = 0;
  pushToOwner(rec, PushChannel.UiTermData, { terminalId: rec.id, data });
  if (rec.paused && rec.pendingBytes < LOW_WATER) {
    rec.pty.resume();
    rec.paused = false;
  }
}

interface SpawnParams {
  cwd?: string;
  cols: number;
  rows: number;
}

ipcMain.handle(
  InvokeChannel.UiTermSpawn,
  (e, p: SpawnParams): { terminalId: string } => {
    const shell =
      process.env.SHELL ||
      (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
    const id = `uiterm-${nextId++}-${Math.random().toString(36).slice(2, 6)}`;
    // Mirror the user's interactive env. PATH inheritance is what makes
    // `pnpm`, `gh`, project-local binaries available out of the box.
    // TERM is forced to xterm-256color so apps like git pick the right
    // capabilities — node-pty itself ignores the host's TERM.
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };
    const pty = ptySpawn(shell, [], {
      name: "xterm-256color",
      cols: p.cols,
      rows: p.rows,
      cwd: p.cwd || homedir(),
      env,
    });
    const rec: TermRecord = {
      id,
      pty,
      ownerWebContentsId: e.sender.id,
      pending: "",
      pendingBytes: 0,
      paused: false,
      flushTimer: null,
      lastCols: p.cols,
      lastRows: p.rows,
    };
    pty.onData((chunk) => {
      rec.pending += chunk;
      rec.pendingBytes += chunk.length;
      if (!rec.paused && rec.pendingBytes >= HIGH_WATER) {
        rec.pty.pause();
        rec.paused = true;
      }
      scheduleFlush(rec);
    });
    pty.onExit(({ exitCode, signal }) => {
      // Flush any tail before sending the exit signal so the user sees
      // the final byte (`logout`, the shell's "[Process completed]"
      // banner) before the panel paints the closed state.
      flushNow(rec);
      pushToOwner(rec, PushChannel.UiTermExit, {
        terminalId: id,
        exitCode: exitCode ?? null,
        signal: typeof signal === "number" ? String(signal) : signal ?? null,
      });
      if (rec.flushTimer) {
        clearTimeout(rec.flushTimer);
        rec.flushTimer = null;
      }
      terms.delete(id);
    });
    terms.set(id, rec);
    return { terminalId: id };
  },
);

ipcMain.handle(
  InvokeChannel.UiTermInput,
  (_e, p: { terminalId: string; data: string }): void => {
    const rec = terms.get(p.terminalId);
    if (!rec) return;
    rec.pty.write(p.data);
  },
);

ipcMain.handle(
  InvokeChannel.UiTermResize,
  (_e, p: { terminalId: string; cols: number; rows: number }): void => {
    const rec = terms.get(p.terminalId);
    if (!rec) return;
    if (rec.lastCols === p.cols && rec.lastRows === p.rows) return;
    rec.lastCols = p.cols;
    rec.lastRows = p.rows;
    try {
      rec.pty.resize(p.cols, p.rows);
    } catch {
      // pty has been killed since the renderer measured — drop silently;
      // the UiTermExit push (already queued) is the authoritative signal.
    }
  },
);

ipcMain.handle(
  InvokeChannel.UiTermDispose,
  (_e, p: { terminalId: string }): void => {
    const rec = terms.get(p.terminalId);
    if (!rec) return;
    try {
      rec.pty.kill();
    } catch {
      // Already dead — onExit handler is the canonical cleanup; this
      // try/catch only protects against double-dispose races.
    }
  },
);

/** Tear down every live terminal — called from app `before-quit` so we
 *  don't leave orphan shells running. */
export function disposeAllUiTerminals(): void {
  for (const rec of terms.values()) {
    try {
      rec.pty.kill();
    } catch {
      /* best-effort */
    }
  }
  terms.clear();
}
