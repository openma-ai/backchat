/**
 * Preload — runs in the isolated context bridging main and renderer. Exposes
 * only the narrow `BackchatApi` surface (see src/shared/api.ts). NEVER reaches
 * out to `ipcRenderer` directly from the renderer.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import type { AgentInfo, BackchatApi } from "../shared/api.js";
import type {
  SessionEventOut,
  SessionPromptParams,
  SessionSetConfigOptionParams,
  SessionStartParams,
} from "../shared/session-events.js";
import type { Settings } from "../shared/settings.js";

const api: BackchatApi = {
  ping: (msg) => ipcRenderer.invoke(InvokeChannel.Ping, msg),

  agentsList: (options) =>
    ipcRenderer.invoke(InvokeChannel.AgentsList, options) as Promise<AgentInfo[]>,
  acpAuthMethods: (agentId) =>
    ipcRenderer.invoke(InvokeChannel.AcpAuthMethods, agentId) as Promise<
      import("../shared/api.js").AcpAuthMethodsResult
    >,
  acpAuthenticate: (agentId, methodId) =>
    ipcRenderer.invoke(InvokeChannel.AcpAuthenticate, { agentId, methodId }) as Promise<void>,
  agentProbe: (id) =>
    ipcRenderer.invoke(InvokeChannel.AgentProbe, id) as Promise<AgentInfo[]>,
  agentInstall: (id) =>
    ipcRenderer.invoke(InvokeChannel.AgentInstall, id) as Promise<AgentInfo[]>,
  agentUpgrade: (id) =>
    ipcRenderer.invoke(InvokeChannel.AgentUpgrade, id) as Promise<AgentInfo[]>,
  agentUninstall: (id) =>
    ipcRenderer.invoke(InvokeChannel.AgentUninstall, id) as Promise<AgentInfo[]>,
  agentAuthenticate: (p) =>
    ipcRenderer.invoke(InvokeChannel.AgentAuthenticate, p) as Promise<AgentInfo[]>,
  agentSetDefault: (id) =>
    ipcRenderer.invoke(InvokeChannel.AgentSetDefault, id) as Promise<AgentInfo[]>,

  sessionStart: (p: SessionStartParams) =>
    ipcRenderer.invoke(InvokeChannel.SessionStart, p) as Promise<void>,
  sessionPrompt: (p: SessionPromptParams) =>
    ipcRenderer.invoke(InvokeChannel.SessionPrompt, p) as Promise<void>,
  sessionSetConfigOption: (p: SessionSetConfigOptionParams) =>
    ipcRenderer.invoke(InvokeChannel.SessionSetConfigOption, p) as Promise<void>,
  sessionCancel: (p) =>
    ipcRenderer.invoke(InvokeChannel.SessionCancel, p) as Promise<void>,
  sessionDispose: (p) =>
    ipcRenderer.invoke(InvokeChannel.SessionDispose, p) as Promise<void>,
  sessionAnnounce: () =>
    ipcRenderer.invoke(InvokeChannel.SessionAnnounce) as Promise<void>,

  pairStart: (p) => ipcRenderer.invoke(InvokeChannel.PairStart, p) as Promise<void>,
  pairPrompt: (p) => ipcRenderer.invoke(InvokeChannel.PairPrompt, p) as Promise<void>,
  pairCancel: (p) => ipcRenderer.invoke(InvokeChannel.PairCancel, p) as Promise<void>,
  pairDispose: (p) => ipcRenderer.invoke(InvokeChannel.PairDispose, p) as Promise<void>,
  pairReleaseMember: (p) =>
    ipcRenderer.invoke(InvokeChannel.PairReleaseMember, p) as Promise<void>,
  pairsList: () =>
    ipcRenderer.invoke(InvokeChannel.PairsList) as Promise<
      import("../shared/api.js").PersistedPairInfo[]
    >,
  pairSave: (p) => ipcRenderer.invoke(InvokeChannel.PairSave, p) as Promise<void>,
  onPairEvent: (handler) => {
    const l = (_e: IpcRendererEvent, ev: import("../shared/pair-events.js").PairEventOut) =>
      handler(ev);
    ipcRenderer.on(PushChannel.PairEvent, l);
    return () => ipcRenderer.removeListener(PushChannel.PairEvent, l);
  },

  sessionsList: (limit) =>
    ipcRenderer.invoke(InvokeChannel.SessionsList, limit) as Promise<
      import("../shared/api.js").PersistedSessionInfo[]
    >,
  sessionsLoadHistory: (sessionId) =>
    ipcRenderer.invoke(InvokeChannel.SessionsLoadHistory, sessionId) as Promise<
      import("../shared/api.js").PersistedEventInfo[]
    >,
  sessionsSearch: (query, limit) =>
    ipcRenderer.invoke(InvokeChannel.SessionsSearch, query, limit) as Promise<
      import("../shared/api.js").SearchHitInfo[]
    >,
  sessionsPin: (p: { session_id: string }) =>
    ipcRenderer.invoke(InvokeChannel.SessionsPin, p) as Promise<void>,
  sessionsUnpin: (p: { session_id: string }) =>
    ipcRenderer.invoke(InvokeChannel.SessionsUnpin, p) as Promise<void>,
  sessionsArchive: (p: { session_id: string }) =>
    ipcRenderer.invoke(InvokeChannel.SessionsArchive, p) as Promise<void>,
  sessionsUnarchive: (p: { session_id: string }) =>
    ipcRenderer.invoke(InvokeChannel.SessionsUnarchive, p) as Promise<void>,
  sessionsListArchived: () =>
    ipcRenderer.invoke(InvokeChannel.SessionsListArchived) as Promise<import("../shared/api.js").PersistedSessionInfo[]>,
  sessionsDelete: (p: { session_id: string }) =>
    ipcRenderer.invoke(InvokeChannel.SessionsDelete, p) as Promise<void>,

  onSessionEvent: (handler) => {
    const listener = (_e: IpcRendererEvent, msg: SessionEventOut) => handler(msg);
    ipcRenderer.on(PushChannel.SessionEvent, listener);
    return () => ipcRenderer.removeListener(PushChannel.SessionEvent, listener);
  },

  settingsGet: () => ipcRenderer.invoke(InvokeChannel.SettingsGet) as Promise<Settings>,
  settingsPatch: (partial) =>
    ipcRenderer.invoke(InvokeChannel.SettingsPatch, partial) as Promise<void>,
  onSettingsChanged: (handler) => {
    const listener = (_e: IpcRendererEvent, s: Settings) => handler(s);
    ipcRenderer.on(PushChannel.SettingsChanged, listener);
    return () => ipcRenderer.removeListener(PushChannel.SettingsChanged, listener);
  },

  // ----- Brokers (Phase 6) -----
  onPermissionRequest: (handler) => {
    const l = (_e: IpcRendererEvent, ask: import("../shared/api.js").PermissionAskInfo) =>
      handler(ask);
    ipcRenderer.on(PushChannel.PermissionRequest, l);
    return () => ipcRenderer.removeListener(PushChannel.PermissionRequest, l);
  },
  permissionRespond: (requestId, optionId) =>
    ipcRenderer.invoke(InvokeChannel.PermissionRespond, { requestId, optionId }) as Promise<void>,

  onFsWriteApproval: (handler) => {
    const l = (_e: IpcRendererEvent, ask: import("../shared/api.js").FsWriteAskInfo) =>
      handler(ask);
    ipcRenderer.on(PushChannel.FsWriteApproval, l);
    return () => ipcRenderer.removeListener(PushChannel.FsWriteApproval, l);
  },
  fsApprovalRespond: (requestId, approved) =>
    ipcRenderer.invoke(InvokeChannel.FsApprovalRespond, { requestId, approved }) as Promise<void>,

  onTerminalOutput: (handler) => {
    const l = (
      _e: IpcRendererEvent,
      f: import("../shared/api.js").TerminalOutputFrame,
    ) => handler(f);
    ipcRenderer.on(PushChannel.TerminalOutput, l);
    return () => ipcRenderer.removeListener(PushChannel.TerminalOutput, l);
  },
  onTerminalExit: (handler) => {
    const l = (
      _e: IpcRendererEvent,
      f: import("../shared/api.js").TerminalExitFrame,
    ) => handler(f);
    ipcRenderer.on(PushChannel.TerminalExit, l);
    return () => ipcRenderer.removeListener(PushChannel.TerminalExit, l);
  },

  // ----- User-facing terminal (bottom panel) -----
  uiTermSpawn: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiTermSpawn, p) as Promise<{ terminalId: string }>,
  uiTermInput: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiTermInput, p) as Promise<void>,
  uiTermResize: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiTermResize, p) as Promise<void>,
  uiTermDispose: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiTermDispose, p) as Promise<void>,
  onUiTermData: (handler) => {
    const l = (
      _e: IpcRendererEvent,
      f: { terminalId: string; data: string },
    ) => handler(f);
    ipcRenderer.on(PushChannel.UiTermData, l);
    return () => ipcRenderer.removeListener(PushChannel.UiTermData, l);
  },
  onUiTermExit: (handler) => {
    const l = (
      _e: IpcRendererEvent,
      f: { terminalId: string; exitCode: number | null; signal: string | null },
    ) => handler(f);
    ipcRenderer.on(PushChannel.UiTermExit, l);
    return () => ipcRenderer.removeListener(PushChannel.UiTermExit, l);
  },

  uiFsListDir: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiFsListDir, p) as Promise<
      { name: string; isDir: boolean; error?: string }[]
    >,
  uiFsHome: () => ipcRenderer.invoke(InvokeChannel.UiFsHome) as Promise<string>,
  uiFsPickDir: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiFsPickDir, p ?? {}) as Promise<string | null>,
  uiFsPickFiles: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiFsPickFiles, p ?? {}) as Promise<
      import("../shared/session-events.js").PromptAttachment[]
    >,
  uiFsRecent: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiFsRecent, p) as Promise<
      { name: string; path: string; isDir: boolean; mtime: number }[]
    >,
  uiFsOpenPath: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiFsOpenPath, p) as Promise<string>,
  uiFsGitBranch: (p) =>
    ipcRenderer.invoke(InvokeChannel.UiFsGitBranch, p) as Promise<string | null>,

  onMenuNavigate: (handler) => {
    const l = (_e: IpcRendererEvent, path: string) => handler(path);
    ipcRenderer.on(PushChannel.MenuNavigate, l);
    return () => ipcRenderer.removeListener(PushChannel.MenuNavigate, l);
  },
  onMenuAction: (handler) => {
    const l = (_e: IpcRendererEvent, action: string) => handler(action);
    ipcRenderer.on(PushChannel.MenuAction, l);
    return () => ipcRenderer.removeListener(PushChannel.MenuAction, l);
  },
};

contextBridge.exposeInMainWorld("backchat", api);

// Dev-only test bridge — exposed as `window.__backchatTest` so e2e
// tests can push canned session payloads through the same channel a
// real ACP child would. The main-side handlers are guarded by
// BACKCHAT_TEST_HOOKS=1 (see ipc.ts), so calling these in production
// just no-ops at the ipcMain level — but we still gate the preload
// surface here too, mostly so dev tools don't tab-complete a footgun.
if (process.env["BACKCHAT_TEST_HOOKS"] === "1") {
  contextBridge.exposeInMainWorld("__backchatTest", {
    injectSessionRow: (p: {
      session_id: string;
      agent_id: string;
      cwd: string;
      acp_session_id?: string;
    }) => ipcRenderer.invoke(InvokeChannel.TestInjectSessionRow, p),
    injectSessionEvent: (msg: unknown) =>
      ipcRenderer.invoke(InvokeChannel.TestInjectSessionEvent, msg),
    persistSessionFixture: (p: {
      sessionId: string;
      agentId?: string;
      cwd?: string;
      acpSessionId?: string;
      title?: string;
      events: Array<{ type: string; data: unknown; ts?: number }>;
    }) => ipcRenderer.invoke(InvokeChannel.TestPersistSessionFixture, p),
    exportSessionFiles: (p?: { overwrite?: boolean }) =>
      ipcRenderer.invoke(InvokeChannel.TestExportSessionFiles, p ?? {}),
    readSessionPrompts: () =>
      ipcRenderer.invoke(InvokeChannel.TestReadSessionPrompts) as Promise<SessionPromptParams[]>,
    readSessionConfigOptions: () =>
      ipcRenderer.invoke(InvokeChannel.TestReadSessionConfigOptions) as Promise<
        SessionSetConfigOptionParams[]
      >,
    setPickedFiles: (files: import("../shared/session-events.js").PromptAttachment[]) =>
      ipcRenderer.invoke(InvokeChannel.TestSetPickedFiles, files),
    setAgentSetupFixture: (fixture: unknown) =>
      ipcRenderer.invoke(InvokeChannel.TestSetAgentSetupFixture, fixture),
    agentSetupCalls: () =>
      ipcRenderer.invoke(InvokeChannel.TestAgentSetupCalls),
  });
}
