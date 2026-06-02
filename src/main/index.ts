import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { InvokeChannel } from "@shared/ipc-channels.js";

// `__dirname` is injected by electron-vite's ESM shim — don't redeclare it,
// the bundle already supplies `const __dirname = import.meta.dirname;`.

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

  // Open every <a target="_blank"> in the user's real browser instead of a
  // new Electron window — we never want a webview popup carrying chrome.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // electron-vite dev server vs production bundle.
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle(InvokeChannel.Ping, (_e, msg: string) => {
    const reply = `pong: ${msg}`;
    process.stdout.write(`[ipc-ping] ${reply}\n`);
    return reply;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
