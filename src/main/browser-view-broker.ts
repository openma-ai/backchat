import { BrowserWindow, ipcMain, webContents } from "electron";

import type {
  BrowserUiCommand,
  BrowserViewIdentityInput,
  BrowserViewRegistrationInput,
} from "../shared/browser-harness.js";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import { BrowserViewRegistry, type BrowserViewTarget } from "./browser-view-registry.js";
import { BrowserWebviewTools } from "./browser-webview-tools.js";
import { ownedBrowserGuest } from "./browser-webview-owner.js";
import { BrowserHarnessMcpBridge } from "./browser-harness-mcp.js";
import { registerBrowserSession } from "./browser-data-broker.js";
import { settingsStore } from "./settings-store.js";
import { browserSettings } from "../shared/browser-settings.js";

export const browserViewRegistry = new BrowserViewRegistry();

function rendererFor(command: BrowserUiCommand) {
  const knownTab = browserViewRegistry.tab(command.sessionId, command.tabId);
  const knownWindowTab = knownTab ?? browserViewRegistry.list(command.sessionId)[0];
  if (knownWindowTab) {
    const host = webContents.fromId(knownWindowTab.hostWebContentsId);
    if (host && !host.isDestroyed()) return host;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused.webContents;
  const fallback = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (fallback) return fallback.webContents;
  throw new Error("No Backchat window is available for the in-app browser");
}

export const browserWebviewTools = new BrowserWebviewTools(browserViewRegistry, {
  requestUi: async (command) => {
    if (!browserSettings(settingsStore.get().browser).enabled) {
      throw new Error("The built-in browser is disabled in Settings");
    }
    rendererFor(command).send(PushChannel.BrowserToolTabCommand, command);
  },
});
export const browserHarnessMcpBridge = new BrowserHarnessMcpBridge(browserWebviewTools);

ipcMain.handle(
  InvokeChannel.BrowserViewRegister,
  async (event, input: BrowserViewRegistrationInput): Promise<void> => {
    const guest = ownedBrowserGuest(event, input?.webContentsId);
    registerBrowserSession(guest.session);
    browserViewRegistry.register({
      sessionId: input.sessionId,
      tabId: input.tabId,
      hostWebContentsId: event.sender.id,
      target: guest as unknown as BrowserViewTarget,
      active: input.active,
    });
  },
);

ipcMain.handle(
  InvokeChannel.BrowserViewUnregister,
  async (event, input: BrowserViewIdentityInput): Promise<void> => {
    const guest = webContents.fromId(input?.webContentsId);
    if (guest && !guest.isDestroyed()) {
      ownedBrowserGuest(event, input.webContentsId);
    }
    browserViewRegistry.unregister(
      input.sessionId,
      input.tabId,
      input.webContentsId,
      event.sender.id,
    );
  },
);

ipcMain.handle(
  InvokeChannel.BrowserViewSetActive,
  async (event, input: BrowserViewIdentityInput): Promise<void> => {
    ownedBrowserGuest(event, input?.webContentsId);
    browserViewRegistry.setActive(input.sessionId, input.tabId, event.sender.id);
  },
);
