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
};

contextBridge.exposeInMainWorld("openma", api);
