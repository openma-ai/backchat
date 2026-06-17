import { app, BrowserWindow, ipcMain, shell, screen } from "electron";
import type { Display, Rectangle } from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  NORMAL_SIZE,
  type EdgeAttachment,
} from "./edge-geometry";
import { findOpenmaPetDeepLink, OPENMA_PET_PROTOCOL, parseOpenmaPetDeepLink, type OpenmaPetDeepLink } from "./pet-deep-link";
import {
  createPetWindowStateMachine,
  type DisplayGeometry,
  type PetWindowCommand,
} from "./pet-window-state-machine";
import { startPetHookServer, type PetHookEvent } from "./pet-hook-server";
import { inferDockBoundsForDisplay } from "./dock-geometry";

let mainWindow: BrowserWindow | null = null;
let applyingSnap = false;
const windowMachine = createPetWindowStateMachine();
const pendingPetLinks: OpenmaPetDeepLink[] = [];
const mainDirname = fileURLToPath(new URL(".", import.meta.url));
const loggedDockGeometry = new Set<string>();
const EVENT_PANEL_SIZE = { width: 520, height: 300 };

function registerPetProtocolClient(): void {
  if (process.defaultApp) {
    const appEntry = process.argv[1];
    if (appEntry) {
      app.setAsDefaultProtocolClient(OPENMA_PET_PROTOCOL, process.execPath, [appEntry]);
      return;
    }
  }
  app.setAsDefaultProtocolClient(OPENMA_PET_PROTOCOL);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: NORMAL_SIZE.width,
    height: NORMAL_SIZE.height,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    title: "OpenMA Pet",
    webPreferences: {
      preload: join(mainDirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.once("ready-to-show", () => win.show());
  win.on("move", () => syncEdgeMode(win));
  win.on("resize", () => syncEdgeMode(win));
  win.webContents.once("did-finish-load", () => notifyEdgeMode(win));
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(mainDirname, "../renderer/index.html"));
  }

  return win;
}

function openPetDeepLink(link: OpenmaPetDeepLink): void {
  logPetHarnessEvent("deeplink", link);
  const win = mainWindow ?? createWindow();
  const send = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send("pet:harness-event", link);
    }
  };
  if (win.webContents.isLoading() || !win.webContents.getURL()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function drainPendingPetLinks(): void {
  let link = pendingPetLinks.shift();
  while (link) {
    openPetDeepLink(link);
    link = pendingPetLinks.shift();
  }
}

function dispatchPetHookEvent(event: PetHookEvent): void {
  logPetHarnessEvent("hook", event);
  const win = mainWindow ?? createWindow();
  const send = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send("pet:harness-event", event);
    }
  };
  if (win.webContents.isLoading() || !win.webContents.getURL()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function logPetHarnessEvent(source: "deeplink" | "hook", event: PetHookEvent | OpenmaPetDeepLink): void {
  if (!process.env["ELECTRON_RENDERER_URL"]) return;
  console.info("[pet-harness-event]", {
    source,
    harness: event.harness,
    event: event.event,
    sessionId: event.sessionId,
    threadId: event.threadId,
    turnId: event.turnId,
    label: event.label,
  });
}

ipcMain.handle("pet:get-window-bounds", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win?.getBounds() ?? NORMAL_SIZE;
});

ipcMain.handle("pet:drag-start", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return NORMAL_SIZE;
  applyPetWindowCommand(win, windowMachine.startDrag(win.getBounds(), getDisplayGeometryForWindow(win)));
  return win.getBounds();
});

ipcMain.on("pet:move-window-to", (event, point: { x: number; y: number }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  win.setPosition(Math.round(point.x), Math.round(point.y), false);
});

ipcMain.on("pet:drag-end", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  applyPetWindowCommand(win, windowMachine.finishDrag(win.getBounds(), getDisplayGeometryForWindow(win)));
});

ipcMain.on("pet:set-event-panel-open", (event, open: boolean) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  setPetEventPanelOpen(win, open === true);
});

function notifyEdgeMode(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  applyPetWindowCommand(win, windowMachine.sync(win.getBounds(), getDisplayGeometryForWindow(win)));
}

function syncEdgeMode(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (applyingSnap) return;
  applyPetWindowCommand(win, windowMachine.sync(win.getBounds(), getDisplayGeometryForWindow(win)));
}

function notifyEdgeAttachment(win: BrowserWindow, attachment: EdgeAttachment): void {
  win.webContents.send("pet:edge-mode", attachment.mode);
  win.webContents.send("pet:edge-attachment", attachment);
}

function applyPetWindowCommand(win: BrowserWindow, command: PetWindowCommand): void {
  if (command.bounds) {
    const bounds = win.getBounds();
    const next = command.bounds;
    logPetSnap(bounds, next, command);
    const unchanged =
      bounds.x === next.x &&
      bounds.y === next.y &&
      bounds.width === next.width &&
      bounds.height === next.height;
    if (!unchanged) {
      applyingSnap = true;
      applyWindowBounds(win, next);
      applyingSnap = false;
      logPetSnapResult(win);
    }
  }
  notifyEdgeAttachment(win, command.attachment);
}

function applyWindowBounds(win: BrowserWindow, next: Rectangle): void {
  const bounds = win.getBounds();
  if (bounds.x !== next.x || bounds.y !== next.y) {
    win.setPosition(next.x, next.y, false);
    logPetBoundsStep("after-position", win);
  }
  if (bounds.width !== next.width || bounds.height !== next.height) {
    win.setSize(next.width, next.height, false);
    logPetBoundsStep("after-size", win);
  }
}

function setPetEventPanelOpen(win: BrowserWindow, open: boolean): void {
  const current = win.getBounds();
  const display = getDisplayForBounds(current).bounds;
  const targetSize = open ? EVENT_PANEL_SIZE : NORMAL_SIZE;
  const anchorRight = current.x + current.width;
  const anchorBottom = current.y + current.height;
  const next = {
    width: targetSize.width,
    height: targetSize.height,
    x: clamp(Math.round(anchorRight - targetSize.width), display.x, display.x + display.width - targetSize.width),
    y: clamp(Math.round(anchorBottom - targetSize.height), display.y, display.y + display.height - targetSize.height),
  };
  applyingSnap = true;
  applyWindowBounds(win, next);
  applyingSnap = false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function logPetBoundsStep(step: string, win: BrowserWindow): void {
  if (!process.env["ELECTRON_RENDERER_URL"]) return;
  console.info("[pet-bounds-step]", {
    step,
    bounds: win.getBounds(),
    contentBounds: win.getContentBounds(),
  });
}

function logPetSnap(bounds: Rectangle, next: Rectangle, command: PetWindowCommand): void {
  if (!process.env["ELECTRON_RENDERER_URL"]) return;
  console.info("[pet-snap]", {
    from: bounds,
    to: next,
    attachment: command.attachment,
    state: command.state,
  });
}

function logPetSnapResult(win: BrowserWindow): void {
  if (!process.env["ELECTRON_RENDERER_URL"]) return;
  console.info("[pet-snap-result]", {
    bounds: win.getBounds(),
    contentBounds: win.getContentBounds(),
  });
}

function getDisplayGeometryForWindow(win: BrowserWindow): DisplayGeometry {
  const display = getDisplayForBounds(win.getBounds());
  const geometry = {
    bounds: display.bounds,
    workArea: display.workArea,
  };
  const dockBounds = inferDockBoundsForDisplay(geometry);
  logDockGeometryOnce(display.id, geometry, dockBounds);
  return {
    ...geometry,
    dockBounds,
  };
}

function getDisplayForBounds(bounds: Rectangle): Display {
  return screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  });
}

function logDockGeometryOnce(
  displayId: number,
  geometry: { bounds: Rectangle; workArea: Rectangle },
  dockBounds: Rectangle | undefined,
): void {
  if (!process.env["ELECTRON_RENDERER_URL"]) return;
  const key = `${displayId}:${geometry.bounds.x},${geometry.bounds.y},${geometry.bounds.width},${geometry.bounds.height}`;
  if (loggedDockGeometry.has(key)) return;
  loggedDockGeometry.add(key);
  console.info("[pet-dock-geometry]", {
    displayId,
    bounds: geometry.bounds,
    workArea: geometry.workArea,
    dockBounds,
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  registerPetProtocolClient();
  app.on("second-instance", (_event, argv) => {
    const link = findOpenmaPetDeepLink(argv);
    if (link) {
      openPetDeepLink(link);
      return;
    }
    if (!mainWindow) createWindow();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const link = parseOpenmaPetDeepLink(url);
    if (!link) return;
    if (app.isReady()) {
      openPetDeepLink(link);
    } else {
      pendingPetLinks.push(link);
    }
  });
  app.whenReady().then(() => {
    createWindow();
    void startPetHookServer({ onEvent: dispatchPetHookEvent })
      .then((server) => {
        if (process.env["ELECTRON_RENDERER_URL"]) {
          console.info("[pet-hook-server]", {
            port: server.port,
            endpoint: `http://127.0.0.1:${server.port}/hook`,
            deeplink: `${OPENMA_PET_PROTOCOL}://event/codex/task.completed?threadId=thread-1&label=Done`,
          });
        }
      })
      .catch((error) => {
        console.error("[pet-hook-server]", error);
      });
    drainPendingPetLinks();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
