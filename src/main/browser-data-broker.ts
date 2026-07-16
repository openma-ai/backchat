import {
  app,
  ipcMain,
  session as electronSession,
  shell,
  webContents,
  type DownloadItem,
  type Session,
  type WebContents,
} from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  BrowserClearDataInput,
  BrowserClearProfileDataInput,
  BrowserDownloadInfo,
  BrowserDownloadState,
} from "../shared/browser-data.js";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import { settingsStore } from "./settings-store.js";
import { ownedBrowserGuest } from "./browser-webview-owner.js";

type TrackedDownload = BrowserDownloadInfo & { item: DownloadItem };

const sessionDownloads = new WeakMap<Session, Map<string, TrackedDownload>>();
const trackedSessions = new WeakSet<Session>();

function senderFor(guest: WebContents): WebContents | null {
  const host = guest.hostWebContents;
  return host && !host.isDestroyed() ? host : null;
}

function stateFor(item: DownloadItem): BrowserDownloadState {
  switch (item.getState()) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "interrupted":
      return "interrupted";
    default:
      return "progressing";
  }
}

function notifyDownloads(guest: WebContents): void {
  senderFor(guest)?.send(PushChannel.BrowserDownloadsChanged);
}

function safeFileName(raw: string, fallback: string): string {
  const value = basename(raw).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return value || fallback;
}

async function preferredDownloadPath(fileName: string): Promise<string> {
  const configured = settingsStore.get().browser?.download_path?.trim();
  const directory = configured || app.getPath("downloads");
  await mkdir(directory, { recursive: true });
  return join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}-${safeFileName(fileName, "download")}`);
}

function currentDownloads(session: Session): BrowserDownloadInfo[] {
  return [...(sessionDownloads.get(session)?.values() ?? [])]
    .map(({ item: _item, ...info }) => ({ ...info }))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function registerBrowserSession(session: Session): void {
  if (trackedSessions.has(session)) return;
  trackedSessions.add(session);
  sessionDownloads.set(session, new Map());
  session.on("will-download", async (event, item, guest) => {
    const downloads = sessionDownloads.get(session)!;
    const id = randomUUID();
    const fileName = item.getFilename() || "download";
    if (settingsStore.get().browser?.ask_before_download) {
      item.setSaveDialogOptions({ defaultPath: await preferredDownloadPath(fileName) });
    } else {
      item.setSavePath(await preferredDownloadPath(fileName));
    }
    const row: TrackedDownload = {
      id,
      fileName,
      url: item.getURL(),
      savePath: item.getSavePath(),
      state: "progressing",
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now(),
      item,
    };
    downloads.set(id, row);
    item.on("updated", () => {
      row.state = stateFor(item);
      row.receivedBytes = item.getReceivedBytes();
      row.totalBytes = item.getTotalBytes();
      row.savePath = item.getSavePath() || row.savePath;
      notifyDownloads(guest);
    });
    item.once("done", () => {
      row.state = stateFor(item);
      row.receivedBytes = item.getReceivedBytes();
      row.totalBytes = item.getTotalBytes();
      row.savePath = item.getSavePath() || row.savePath;
      notifyDownloads(guest);
    });
    notifyDownloads(guest);
  });
}

function guestFor(event: Electron.IpcMainInvokeEvent, webContentsId: number): WebContents {
  const guest = ownedBrowserGuest(event, webContentsId);
  registerBrowserSession(guest.session);
  return guest;
}

ipcMain.handle(
  InvokeChannel.BrowserCaptureScreenshot,
  async (event, input: { webContentsId: number }): Promise<{ path: string }> => {
    const guest = guestFor(event, input?.webContentsId);
    const image = await guest.capturePage();
    const path = await preferredDownloadPath("page-screenshot.png");
    await writeFile(path, image.toPNG(), { flag: "wx" });
    return { path };
  },
);

ipcMain.handle(
  InvokeChannel.BrowserShowDeviceToolbar,
  async (event, input: { webContentsId: number }): Promise<void> => {
    const guest = guestFor(event, input?.webContentsId);
    guest.openDevTools({ mode: "detach", activate: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 160));
    const devtools = guest.devToolsWebContents;
    if (!devtools || devtools.isDestroyed()) return;
    await devtools.executeJavaScript("document.body != null", true).catch(() => undefined);
    devtools.sendInputEvent({
      type: "keyDown",
      keyCode: "M",
      modifiers: process.platform === "darwin" ? ["meta", "shift"] : ["control", "shift"],
    });
    devtools.sendInputEvent({
      type: "keyUp",
      keyCode: "M",
      modifiers: process.platform === "darwin" ? ["meta", "shift"] : ["control", "shift"],
    });
  },
);

ipcMain.handle(
  InvokeChannel.BrowserClearData,
  async (event, input: BrowserClearDataInput): Promise<void> => {
    const guest = guestFor(event, input?.webContentsId);
    const kinds = new Set(input?.kinds ?? []);
    if (kinds.has("cache")) await guest.session.clearCache();
    if (kinds.has("cookies")) {
      await guest.session.clearData({
        dataTypes: ["cookies", "fileSystems", "indexedDB", "localStorage", "serviceWorkers", "webSQL"],
      });
    }
    if (kinds.has("history")) guest.clearHistory();
    // Password storage is intentionally separate from Chromium's opaque
    // profile database. A future system-profile importer will clear it here.
  },
);

ipcMain.handle(
  InvokeChannel.BrowserClearProfileData,
  async (_event, input: BrowserClearProfileDataInput): Promise<void> => {
    const profile = electronSession.fromPartition("memory:browser");
    const kinds = new Set(input?.kinds ?? []);
    if (kinds.has("cache")) await profile.clearCache();
    if (kinds.has("cookies")) {
      await profile.clearData({
        dataTypes: ["cookies", "fileSystems", "indexedDB", "localStorage", "serviceWorkers", "webSQL"],
      });
    }
  },
);

ipcMain.handle(
  InvokeChannel.BrowserDownloadsList,
  async (event, input: { webContentsId: number }): Promise<BrowserDownloadInfo[]> => {
    const guest = guestFor(event, input?.webContentsId);
    return currentDownloads(guest.session);
  },
);

ipcMain.handle(
  InvokeChannel.BrowserCredentialsList,
  async (event, input: { webContentsId: number }) => {
    guestFor(event, input?.webContentsId);
    // Chromium's encrypted Login Data is intentionally not treated as an
    // export file. System-profile migration will populate this list once the
    // user explicitly selects a local browser profile.
    return [];
  },
);

ipcMain.handle(
  InvokeChannel.BrowserCredentialFill,
  async (event, input: { webContentsId: number; credentialId: string }): Promise<void> => {
    guestFor(event, input?.webContentsId);
    throw new Error("No saved browser credential is available");
  },
);

ipcMain.handle(
  InvokeChannel.BrowserCredentialDelete,
  async (event, input: { webContentsId: number; credentialId: string }): Promise<void> => {
    guestFor(event, input?.webContentsId);
  },
);

ipcMain.handle(
  InvokeChannel.BrowserDownloadAction,
  async (
    event,
    input: { webContentsId: number; downloadId: string; action: "open" | "reveal" | "cancel" },
  ): Promise<void> => {
    const guest = guestFor(event, input?.webContentsId);
    const row = sessionDownloads.get(guest.session)?.get(input?.downloadId);
    if (!row) throw new Error("Download is no longer available");
    if (input.action === "cancel") row.item.cancel();
    else if (input.action === "reveal") shell.showItemInFolder(row.savePath);
    else await shell.openPath(row.savePath);
  },
);
