/**
 * IPC handler registration — bridges main's SessionManager to the renderer.
 *
 * Renderer calls `window.backchat.foo(...)` (preload), which `ipcRenderer.invoke`s
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
import type {
  PairEventOut,
  PairPromptParams,
  PairStartParams,
} from "../shared/pair-events.js";
import type { Settings } from "../shared/settings.js";
import { detectAll, getKnownAgents, loadRegistry } from "@open-managed-agents-desktop/acp/registry";
import { SessionManager } from "./session-manager.js";
import { PairManager } from "./pair-manager.js";
import { settingsStore } from "./settings-store.js";
import { archiveSession, deleteSession, listArchivedSessions, listSessions, loadHistory, pinSession, searchMessages, unarchiveSession, unpinSession } from "./sql-store.js";
import { removeSessionCwd } from "./session-cwd.js";
import { forwardSessionEventToPet } from "./pet-hook-bridge.js";
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
// Side-effect import: registers ipcMain handlers for the UI terminal
// (bottom-panel pty shells). Distinct from the ACP brokers above.
import "./ui-terminal-broker.js";
// Side-effect import: directory listing for the side-panel file tree.
import "./ui-fs-broker.js";

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
  // Two outbound sinks: single-session events and pair events. Both
  // ultimately broadcast to all browser windows, just on distinct
  // channels so the renderer can wire them to independent reducers.
  const singleSink = (msg: SessionEventOut) => {
    forwardSessionEventToPet(msg);
    if (msg.type !== "session.event") {
      process.stdout.write(`[session] ${msg.type} sid=${msg.session_id.slice(0, 8)}\n`);
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(PushChannel.SessionEvent, msg);
    }
  };
  const pairSink = (msg: PairEventOut) => {
    if (msg.type !== "pair.event") {
      process.stdout.write(`[pair] ${msg.type} pid=${msg.pair_id.slice(0, 8)}\n`);
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(PushChannel.PairEvent, msg);
    }
  };

  // Forward declaration — pairManager is constructed AFTER sessionManager
  // (it takes sessionManager as a dep), but the SessionManager's send tee
  // closes over `pairManager` so we need a mutable holder. The tee is
  // safe to call before pairManager exists: it just falls through to the
  // single sink, which is the correct behavior for the boot window
  // before any pair is registered.
  let pairManager: PairManager | null = null;
  const send = (msg: SessionEventOut) => {
    if (pairManager && pairManager.routeOrPassthrough(msg)) return;
    singleSink(msg);
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
        permissionMode: s.default.permission_mode,
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

  // Pair manager — sibling of sessionManager. Holds a reference and
  // calls its 1:1 API; the tee installed above routes pair-owned
  // session events into PairManager's reshape path.
  pairManager = new PairManager({ sessionManager, pairSink });

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

  ipcMain.handle(
    InvokeChannel.AcpAuthMethods,
    (_e, agentId: string) => sessionManager.probeAuthMethods(agentId),
  );
  ipcMain.handle(
    InvokeChannel.AcpAuthenticate,
    (_e, p: { agentId: string; methodId: string }) =>
      sessionManager.authenticateAgent(p.agentId, p.methodId),
  );

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
  ipcMain.handle(InvokeChannel.SessionAnnounce, () => {
    sessionManager.announceAll();
    pairManager?.announcePairs();
  });

  ipcMain.handle(InvokeChannel.PairStart, (_e, p: PairStartParams) =>
    pairManager!.startPair(p),
  );
  ipcMain.handle(InvokeChannel.PairPrompt, (_e, p: PairPromptParams) =>
    pairManager!.promptPair(p),
  );
  ipcMain.handle(
    InvokeChannel.PairCancel,
    (_e, p: { pair_id: string; turn_id: string }) =>
      pairManager!.cancelPair(p.pair_id, p.turn_id),
  );
  ipcMain.handle(InvokeChannel.PairDispose, (_e, p: { pair_id: string }) =>
    pairManager!.disposePair(p.pair_id),
  );
  ipcMain.handle(
    InvokeChannel.PairReleaseMember,
    (_e, p: { pair_id: string; session_id: string }) =>
      pairManager!.releaseMember(p.pair_id, p.session_id),
  );

  ipcMain.handle(InvokeChannel.SessionsList, (_e, limit?: number):
    PersistedSessionInfo[] => listSessions(limit));
  ipcMain.handle(InvokeChannel.SessionsPin, (_e, p: { session_id: string }) =>
    pinSession(p.session_id));
  ipcMain.handle(InvokeChannel.SessionsUnpin, (_e, p: { session_id: string }) =>
    unpinSession(p.session_id));
  ipcMain.handle(InvokeChannel.SessionsArchive, (_e, p: { session_id: string }) =>
    archiveSession(p.session_id));
  ipcMain.handle(InvokeChannel.SessionsUnarchive, (_e, p: { session_id: string }) =>
    unarchiveSession(p.session_id));
  ipcMain.handle(InvokeChannel.SessionsListArchived, () => listArchivedSessions());
  // Hard delete: drop the SQL row (events cascade) AND the on-disk
  // session dir. Order matters — wipe the dir first so a partial
  // failure leaves the row to retry from; if we deleted the row
  // first and the rm threw, the file would be orphaned and harder
  // to find later. Dispose the ACP child too if it's still running
  // (e.g. user is deleting an archived session that was somehow
  // resumed in the background).
  ipcMain.handle(
    InvokeChannel.SessionsDelete,
    async (_e, p: { session_id: string }) => {
      try {
        // removeCwd:true here would also be fine, but we always call
        // removeSessionCwd below anyway, so let dispose just tear
        // down the ACP child and leave file cleanup to one place.
        await sessionManager.dispose(p.session_id);
      } catch {
        /* not running — fine */
      }
      try {
        await removeSessionCwd(p.session_id);
      } catch {
        /* dir might be gone already — fine */
      }
      deleteSession(p.session_id);
    },
  );
  ipcMain.handle(
    InvokeChannel.SessionsLoadHistory,
    (_e, sessionId: string): PersistedEventInfo[] => loadHistory(sessionId),
  );
  ipcMain.handle(
    InvokeChannel.SessionsSearch,
    (_e, query: string, limit?: number) => searchMessages(query, limit),
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

  // Dev-only test hooks — let e2e tests inject canned session.ready /
  // session.event / session.complete payloads straight onto the renderer
  // push channel without spawning a real ACP child. Guarded by an env
  // var so production builds never expose these. Tests set
  // BACKCHAT_TEST_HOOKS=1 when launching electron.
  if (process.env["BACKCHAT_TEST_HOOKS"] === "1") {
    process.stdout.write("[ipc] test hooks enabled\n");
    ipcMain.handle(
      InvokeChannel.TestInjectSessionRow,
      (
        _e,
        p: { session_id: string; agent_id: string; cwd: string; acp_session_id?: string },
      ) => {
        send({
          type: "session.ready",
          session_id: p.session_id,
          acp_session_id: p.acp_session_id ?? `acp-${p.session_id}`,
          agent_id: p.agent_id,
          cwd: p.cwd,
        });
      },
    );
    ipcMain.handle(
      InvokeChannel.TestInjectSessionEvent,
      (_e, msg: SessionEventOut) => {
        // Pass-through — test fully controls what shape it pushes.
        send(msg);
      },
    );
  }

  return sessionManager;
}
