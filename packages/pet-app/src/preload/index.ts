import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export type PetEdgeMode = "none" | "left" | "right" | "top" | "bottom";
export type PetEdgeSurface = "screen" | "dock";
export type PetEdgeAttachment = { mode: PetEdgeMode; surface: PetEdgeSurface };
export type PetWindowBounds = { x: number; y: number; width: number; height: number };
export type PetHarnessEvent = {
  harness: string;
  event: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  agentId?: string;
  label?: string;
  payload?: unknown;
};
export type PetAckEvent = {
  harness: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  reason?: string;
};

contextBridge.exposeInMainWorld("openmaPet", {
  onEdgeMode(handler: (mode: PetEdgeMode) => void) {
    const listener = (_event: IpcRendererEvent, mode: PetEdgeMode) => handler(mode);
    ipcRenderer.on("pet:edge-mode", listener);
    return () => ipcRenderer.removeListener("pet:edge-mode", listener);
  },
  onEdgeAttachment(handler: (attachment: PetEdgeAttachment) => void) {
    const listener = (_event: IpcRendererEvent, attachment: PetEdgeAttachment) => handler(attachment);
    ipcRenderer.on("pet:edge-attachment", listener);
    return () => ipcRenderer.removeListener("pet:edge-attachment", listener);
  },
  onHarnessEvent(handler: (event: PetHarnessEvent) => void) {
    const listener = (_event: IpcRendererEvent, petEvent: PetHarnessEvent) => handler(petEvent);
    ipcRenderer.on("pet:harness-event", listener);
    return () => ipcRenderer.removeListener("pet:harness-event", listener);
  },
  onAckEvent(handler: (event: PetAckEvent) => void) {
    const listener = (_event: IpcRendererEvent, petEvent: PetAckEvent) => handler(petEvent);
    ipcRenderer.on("pet:ack-event", listener);
    return () => ipcRenderer.removeListener("pet:ack-event", listener);
  },
  getWindowBounds(): Promise<PetWindowBounds> {
    return ipcRenderer.invoke("pet:get-window-bounds");
  },
  startWindowDrag(): Promise<PetWindowBounds> {
    return ipcRenderer.invoke("pet:drag-start");
  },
  moveWindowTo(point: { x: number; y: number }) {
    ipcRenderer.send("pet:move-window-to", point);
  },
  endWindowDrag() {
    ipcRenderer.send("pet:drag-end");
  },
  setEventPanelOpen(open: boolean) {
    ipcRenderer.send("pet:set-event-panel-open", open);
  },
  openNavigationUrl(url: string): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke("pet:open-navigation-url", url);
  },
  ackHarnessEvent(event: PetAckEvent) {
    ipcRenderer.send("pet:ack-harness-event", event);
  },
});
