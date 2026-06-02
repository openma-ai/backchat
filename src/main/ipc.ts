/**
 * IPC handler registration — bridges main's SessionManager to the renderer.
 *
 * Renderer calls `window.openma.foo(...)` (preload), which `ipcRenderer.invoke`s
 * into one of these handlers. Outbound `session.event` etc. are pushed via
 * `webContents.send` from the SessionManager's `Sender` callback.
 */

import { BrowserWindow, ipcMain } from "electron";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import type { AgentInfo, PersistedEventInfo, PersistedSessionInfo } from "../shared/api.js";
import type {
  SessionEventOut,
  SessionPromptParams,
  SessionStartParams,
} from "../shared/session-events.js";
import type { Settings } from "../shared/settings.js";
import { detectAll, getKnownAgents, loadRegistry } from "@open-managed-agents-desktop/acp/registry";
import { SessionManager } from "./session-manager.js";
import { settingsStore } from "./settings-store.js";
import { listSessions, loadHistory } from "./sql-store.js";
import {
  cancelPendingFor,
  createTerminal,
  killTerminal,
  readTextFile,
  registerBrokers,
  releaseTerminal,
  requestPermission,
  terminalOutput,
  waitForTerminalExit,
  writeTextFile,
} from "./brokers.js";

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
    // MCP servers come from settings now — Phase 8 finishes the per-agent
    // override matrix; for now we pass every configured server through to
    // every spawn. ACP McpServer shape matches our SettingsMcpServer.
    resolveMcpServers: () => settingsStore.get().mcp_servers as unknown[],
    resolveDefaults: () => {
      const s = settingsStore.get();
      return {
        agentId: s.default.agent_id || undefined,
        cwd: s.default.workspace_path || undefined,
      };
    },
    resolveAgentOverride: (agentId) => {
      const o = settingsStore.get().agents.find((a) => a.id === agentId);
      if (!o) return undefined;
      // Convert the {name,value}[] pairs back to the Record<string,string>
      // shape NodeSpawner consumes. Empty values pass through; users may
      // intentionally set a var to "" to clear an inherited value.
      const envOverride: Record<string, string> = {};
      for (const e of o.env) envOverride[e.name] = e.value;
      return {
        commandOverride: o.command_override,
        argsOverride: o.args_override,
        envOverride,
      };
    },
    // Phase 6: permission / fs / terminal brokers — wired so the agent
    // can actually read files, write files, run commands. Defaults are no
    // longer "deny" — they go to a renderer modal (permission, out-of-cwd
    // writes) or straight to child_process (terminal).
    //
    // The brokers accept/return `unknown` shapes that match ACP's
    // request/response schema at runtime; the vendored acp package's
    // ClientCallbacks type narrows on the SDK types. We trust the
    // brokers to follow the schema (smoke-tested against claude-acp).
    buildCallbacks: (sessionId, sessionCwd) => ({
      requestPermission: (params) =>
        requestPermission(sessionId, params) as never,
      readTextFile: (params) => readTextFile(params) as never,
      writeTextFile: (params) =>
        writeTextFile(sessionId, sessionCwd, params) as never,
      createTerminal: async (params) =>
        createTerminal(sessionId, sessionCwd, params) as never,
      terminalOutput: async (params) => terminalOutput(params) as never,
      releaseTerminal: async (params) => releaseTerminal(params) as never,
      waitForTerminalExit: (params) =>
        waitForTerminalExit(params) as never,
      killTerminal: async (params) => killTerminal(params) as never,
    }),
  });
  sessionManager.setOnSessionGone(cancelPendingFor);

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

  ipcMain.handle(InvokeChannel.SessionsList, (_e, limit?: number):
    PersistedSessionInfo[] => listSessions(limit));
  ipcMain.handle(
    InvokeChannel.SessionsLoadHistory,
    (_e, sessionId: string): PersistedEventInfo[] => loadHistory(sessionId),
  );

  // ---- Settings ----
  ipcMain.handle(InvokeChannel.SettingsGet, (): Settings => settingsStore.get());
  ipcMain.handle(
    InvokeChannel.SettingsPatch,
    (_e, partial: Partial<Settings>) => settingsStore.patch(partial),
  );
  // Push every settings mutation out to all open windows. Subscribed once
  // at registration; never unsubscribed (the store lives for the process
  // lifetime).
  settingsStore.subscribe((s) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(PushChannel.SettingsChanged, s);
    }
  });

  // Wire permission / fs-approval response IPCs.
  registerBrokers();

  return sessionManager;
}
