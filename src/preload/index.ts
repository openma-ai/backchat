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

  browserList: () =>
    ipcRenderer.invoke(InvokeChannel.BrowserList) as Promise<
      import("../shared/browser-plugin.js").BrowserDescriptor[]
    >,
  browserGet: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserGet, p) as Promise<
      import("../shared/browser-plugin.js").BrowserDescriptor
    >,
  browserTabs: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserTabs, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo[]
    >,
  browserGetTab: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserGetTab, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo
    >,
  browserSelectedTab: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserSelectedTab, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo | null
    >,
  browserUserOpenTabs: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserUserOpenTabs, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo[]
    >,
  browserSelectTab: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserSelectTab, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo
    >,
  browserNameSession: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserNameSession, p) as Promise<{
      browser: string;
      name: string;
    }>,
  browserSessionName: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserSessionName, p) as Promise<string | null>,
  browserNewTab: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserNewTab, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo
    >,
  browserGoto: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserGoto, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo
    >,
  browserSetVisibility: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserSetVisibility, p) as Promise<void>,
  browserGetVisibility: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserGetVisibility, p) as Promise<boolean>,
  browserSetViewport: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserSetViewport, p) as Promise<void>,
  browserResetViewport: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserResetViewport, p) as Promise<void>,
  browserAttachView: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserAttachView, p) as Promise<void>,
  browserDetachView: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserDetachView, p) as Promise<void>,
  browserReload: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserReload, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo
    >,
  browserBack: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserBack, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo
    >,
  browserForward: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserForward, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo
    >,
  browserWaitForURL: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserWaitForURL, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo
    >,
  browserWaitForLoadState: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserWaitForLoadState, p) as Promise<
      import("../shared/browser-plugin.js").BrowserTabInfo
    >,
  browserTitle: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserTitle, p) as Promise<string | null>,
  browserUrl: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserUrl, p) as Promise<string | null>,
  browserCloseTab: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserCloseTab, p) as Promise<void>,
  browserScreenshot: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserScreenshot, p) as Promise<
      import("../shared/browser-plugin.js").BrowserScreenshotResult
    >,
  browserPageAssets: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserPageAssets, p) as Promise<
      import("../shared/browser-plugin.js").BrowserPageAssetEntry[]
    >,
  browserBundleAssets: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserBundleAssets, p) as Promise<
      import("../shared/browser-plugin.js").BrowserAssetBundleResult
    >,
  browserDomSnapshot: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserDomSnapshot, p) as Promise<string>,
  browserEvaluate: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserEvaluate, p) as Promise<unknown>,
  browserClick: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserClick, p) as Promise<void>,
  browserType: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserType, p) as Promise<void>,
  browserPress: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserPress, p) as Promise<void>,
  browserCuaClick: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserCuaClick, p) as Promise<void>,
  browserDomCuaSnapshot: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserDomCuaSnapshot, p) as Promise<string>,
  browserDomCuaClick: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserDomCuaClick, p) as Promise<void>,
  browserLocatorCount: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserLocatorCount, p) as Promise<number>,
  browserLocatorClick: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserLocatorClick, p) as Promise<void>,
  browserLocatorFill: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserLocatorFill, p) as Promise<void>,
  browserLocatorPress: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserLocatorPress, p) as Promise<void>,
  browserLocatorSetChecked: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserLocatorSetChecked, p) as Promise<void>,
  browserLocatorSelectOption: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserLocatorSelectOption, p) as Promise<void>,
  browserLocatorInnerText: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserLocatorInnerText, p) as Promise<string>,
  browserLocatorAttribute: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserLocatorAttribute, p) as Promise<string | null>,
  browserDialog: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserDialog, p) as Promise<
      import("../shared/browser-plugin.js").BrowserDialogInfo | null
    >,
  browserAcceptDialog: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserAcceptDialog, p) as Promise<void>,
  browserDismissDialog: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserDismissDialog, p) as Promise<void>,
  browserClipboardReadText: () =>
    ipcRenderer.invoke(InvokeChannel.BrowserClipboardReadText) as Promise<string>,
  browserClipboardWriteText: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserClipboardWriteText, p) as Promise<void>,
  browserDevLogs: (p) =>
    ipcRenderer.invoke(InvokeChannel.BrowserDevLogs, p) as Promise<
      import("../shared/browser-plugin.js").BrowserDevLogEntry[]
    >,
  onBrowserPluginState: (handler) => {
    const l = (
      _e: IpcRendererEvent,
      event: import("../shared/browser-plugin.js").BrowserPluginStateEvent,
    ) => handler(event);
    ipcRenderer.on(PushChannel.BrowserState, l);
    return () => ipcRenderer.removeListener(PushChannel.BrowserState, l);
  },

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
