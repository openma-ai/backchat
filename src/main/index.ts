import { app, BrowserWindow, dialog, shell } from "electron";
import { join } from "node:path";
import { registerIpc } from "./ipc.js";
import { setSessionRoot } from "./session-cwd.js";
import { settingsStore } from "./settings-store.js";
import { openSessionDb } from "./sql-store.js";
import { installAppMenu, sendToFocused } from "./menu.js";

const windows = new Set<BrowserWindow>();

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#0b0b0c",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  windows.add(win);
  win.on("closed", () => windows.delete(win));

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

// Only one Electron process; secondary launches surface as a new window
// in the existing instance via second-instance event.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => createWindow());

  app.whenReady().then(async () => {
    try {
      await settingsStore.load();
    } catch (e) {
      dialog.showErrorBox(
        "Settings file error",
        `${(e as Error).message}\n\nopenma-desktop will start with default settings.`,
      );
    }

    const userData = app.getPath("userData");
    setSessionRoot(join(userData, "sessions"));
    openSessionDb(join(userData, "sessions.db"));
    registerIpc({ registryCachePath: join(userData, "registry-cache.json") });

    installAppMenu({
      openNewWindow: () => createWindow(),
      focusedWebContentsSend: sendToFocused,
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
