/**
 * IPC handler registration — bridges main's SessionManager to the renderer.
 *
 * Renderer calls `window.openma.foo(...)` (preload), which `ipcRenderer.invoke`s
 * into one of these handlers. Outbound `session.event` etc. are pushed via
 * `webContents.send` from the SessionManager's `Sender` callback.
 */

import { BrowserWindow, ipcMain } from "electron";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import type { AgentInfo } from "../shared/api.js";
import type {
  SessionEventOut,
  SessionPromptParams,
  SessionStartParams,
} from "../shared/session-events.js";
import { detectAll, getKnownAgents, loadRegistry } from "@open-managed-agents-desktop/acp/registry";
import { SessionManager } from "./session-manager.js";

interface RegisterDeps {
  /** Path used to cache the live ACP registry JSON. Phase 1 stub returns the
   *  overlay-only set; later phases pass `app.getPath('userData')/...` */
  registryCachePath: string;
}

/**
 * Wire up IPC + return the singleton SessionManager. The manager's `Sender`
 * pushes events to every active BrowserWindow — works for the multi-window
 * case in Phase 9, and is a no-op when no window is open (renderer reload
 * picks up via `sessionAnnounce`).
 */
export function registerIpc(deps: RegisterDeps): SessionManager {
  const send = (msg: SessionEventOut) => {
    // Stderr trace — visible in --enable-logging=stdout. One line per event
    // so smoke tests can grep for the lifecycle markers.
    if (msg.type !== "session.event") {
      process.stdout.write(`[session] ${msg.type} sid=${msg.session_id.slice(0, 8)}\n`);
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(PushChannel.SessionEvent, msg);
    }
  };

  const sessionManager = new SessionManager({
    send,
    // Phase 2: no MCP servers yet. Phase 8 wires McpConfigStore here.
    resolveMcpServers: () => [],
    // Phase 2: no permission/fs/terminal brokers yet — every callback
    // bubbles into the runtime's default-deny. Phase 6 swaps this with real
    // brokers.
    buildCallbacks: () => ({}),
  });

  ipcMain.handle(InvokeChannel.Ping, (_e, msg: string) => {
    const reply = `pong: ${msg}`;
    process.stdout.write(`[ipc-ping] ${reply}\n`);
    return reply;
  });

  ipcMain.handle(InvokeChannel.AgentsList, async (): Promise<AgentInfo[]> => {
    // Best-effort: refresh the live registry once per call (cheap — 1h TTL
    // cache means the second call within an hour is a noop disk read).
    await loadRegistry({ cachePath: deps.registryCachePath }).catch(() => undefined);
    const detected = new Set((await detectAll()).map((a) => a.id));
    return getKnownAgents().map((a) => ({
      id: a.id,
      label: a.label,
      command: a.spec.command,
      installHint: a.installHint,
      homepage: a.homepage,
      featured: a.featured,
      detected: detected.has(a.id),
    }));
  });

  ipcMain.handle(InvokeChannel.SessionStart, (_e, p: SessionStartParams) =>
    sessionManager.start(p),
  );
  ipcMain.handle(InvokeChannel.SessionPrompt, (_e, p: SessionPromptParams) =>
    sessionManager.prompt(p),
  );
  ipcMain.handle(
    InvokeChannel.SessionCancel,
    (_e, p: { session_id: string; turn_id: string }) =>
      sessionManager.cancel(p.session_id, p.turn_id),
  );
  ipcMain.handle(
    InvokeChannel.SessionDispose,
    (_e, p: { session_id: string; remove_cwd?: boolean }) =>
      sessionManager.dispose(p.session_id, { removeCwd: p.remove_cwd }),
  );
  ipcMain.handle(InvokeChannel.SessionAnnounce, () => sessionManager.announceAll());

  return sessionManager;
}
