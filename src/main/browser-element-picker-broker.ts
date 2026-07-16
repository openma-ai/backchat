import {
  ipcMain,
  webContents,
  type WebContents,
} from "electron";

import { InvokeChannel } from "../shared/ipc-channels.js";
import {
  BrowserElementPickerService,
  type BrowserElementPickerTarget,
} from "./browser-element-picker.js";
import { ownedBrowserGuest } from "./browser-webview-owner.js";

const picker = new BrowserElementPickerService();

function pickerTarget(guest: WebContents): BrowserElementPickerTarget {
  return guest as unknown as BrowserElementPickerTarget;
}

ipcMain.handle(
  InvokeChannel.BrowserElementPickerBegin,
  async (event, p: { webContentsId: number }): Promise<void> => {
    await picker.begin(pickerTarget(ownedBrowserGuest(event, p?.webContentsId)));
  },
);

ipcMain.handle(
  InvokeChannel.BrowserElementPickerHover,
  async (
    event,
    p: { webContentsId: number; x: number; y: number },
  ) => {
    ownedBrowserGuest(event, p?.webContentsId);
    return picker.hover(p.webContentsId, { x: p.x, y: p.y });
  },
);

ipcMain.handle(
  InvokeChannel.BrowserElementPickerCommit,
  async (event, p: { webContentsId: number }) => {
    ownedBrowserGuest(event, p?.webContentsId);
    return picker.commit(p.webContentsId);
  },
);

ipcMain.handle(
  InvokeChannel.BrowserElementPickerCaptureRegion,
  async (
    event,
    p: {
      webContentsId: number;
      rect: { x: number; y: number; width: number; height: number };
    },
  ) => {
    ownedBrowserGuest(event, p?.webContentsId);
    return picker.captureRegion(p.webContentsId, p.rect);
  },
);

ipcMain.handle(
  InvokeChannel.BrowserElementPickerCancel,
  async (event, p: { webContentsId: number }): Promise<void> => {
    const guest = webContents.fromId(p?.webContentsId);
    if (!guest || guest.isDestroyed()) {
      await picker.cancel(p?.webContentsId);
      return;
    }
    ownedBrowserGuest(event, p.webContentsId);
    await picker.cancel(p.webContentsId);
  },
);
