/**
 * Preload — runs in the isolated context bridging main and renderer. Exposes
 * only the narrow `OpenmaApi` surface (see src/shared/api.ts). NEVER reaches
 * out to `ipcRenderer` directly from the renderer.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import type { AgentInfo, OpenmaApi } from "../shared/api.js";
import type {
  SessionEventOut,
  SessionPromptParams,
  SessionStartParams,
} from "../shared/session-events.js";
import type { Settings } from "../shared/settings.js";

const api: OpenmaApi = {
  ping: (msg) => ipcRenderer.invoke(InvokeChannel.Ping, msg),

  agentsList: () => ipcRenderer.invoke(InvokeChannel.AgentsList) as Promise<AgentInfo[]>,

  sessionStart: (p: SessionStartParams) =>
    ipcRenderer.invoke(InvokeChannel.SessionStart, p) as Promise<void>,
  sessionPrompt: (p: SessionPromptParams) =>
    ipcRenderer.invoke(InvokeChannel.SessionPrompt, p) as Promise<void>,
  sessionCancel: (p) =>
    ipcRenderer.invoke(InvokeChannel.SessionCancel, p) as Promise<void>,
  sessionDispose: (p) =>
    ipcRenderer.invoke(InvokeChannel.SessionDispose, p) as Promise<void>,
  sessionAnnounce: () =>
    ipcRenderer.invoke(InvokeChannel.SessionAnnounce) as Promise<void>,

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

contextBridge.exposeInMainWorld("openma", api);
