import {
  webContents,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

/** Resolve a renderer-supplied WebView id and prove it belongs to the
 *  renderer that invoked IPC. This is the browser permission boundary. */
export function ownedBrowserGuest(
  event: IpcMainInvokeEvent,
  webContentsId: number,
): WebContents {
  if (!Number.isInteger(webContentsId) || webContentsId <= 0) {
    throw new Error("Browser webContents id is invalid");
  }
  const guest = webContents.fromId(webContentsId);
  if (
    !guest ||
    guest.isDestroyed() ||
    guest.getType() !== "webview" ||
    guest.hostWebContents?.id !== event.sender.id
  ) {
    throw new Error("Browser view does not belong to this window");
  }
  return guest;
}
