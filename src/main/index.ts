import { app, BrowserWindow, dialog, shell } from "electron";
import { join } from "node:path";
import { registerIpc } from "./ipc.js";
import { setSessionRoot } from "./session-cwd.js";
import { settingsStore } from "./settings-store.js";
import { openSessionDb } from "./sql-store.js";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
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

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  // Load settings before anything else — registerIpc reads the MCP server
  // list during SessionManager construction. A broken config.toml is a
  // user-fixable error, not a crash; show a dialog and continue with
  // in-memory defaults.
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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
