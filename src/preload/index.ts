/**
 * Preload — runs in the isolated context bridging main and renderer.
 *
 * Only narrow, typed functions cross to the renderer. NEVER expose ipcRenderer
 * directly; that defeats sandboxing.
 */
import { contextBridge, ipcRenderer } from "electron";
import { InvokeChannel } from "@shared/ipc-channels.js";
import type { OpenmaApi } from "@shared/api.js";

const api: OpenmaApi = {
  ping: (msg) => ipcRenderer.invoke(InvokeChannel.Ping, msg),
};

contextBridge.exposeInMainWorld("openma", api);
