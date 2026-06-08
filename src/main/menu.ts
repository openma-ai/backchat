/**
 * Application menu — OS-native menubar (macOS top bar, Windows/Linux app
 * menu). Wires the standard chrome shortcuts (Quit, Preferences, About,
 * Hide, Window list) plus our app-specific actions (New Chat ⌘N, Open
 * Settings ⌘,). Without an explicit menu, Electron ships the default
 * "File / Edit / View / Window / Help" stubs that don't map to anything
 * meaningful in our app and miss our shortcuts.
 *
 * Single source of shortcut truth: menu accelerators here, NOT
 * window-level keydown handlers. That keeps macOS's "in-menu hint" and
 * the actual key binding in sync (otherwise users see `⌘N` in the menu
 * but it does nothing because a renderer handler ate the keystroke).
 */

import {
  app,
  BrowserWindow,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { syncTrafficLight } from "./index.js";
import { PushChannel } from "../shared/ipc-channels.js";

const isMac = process.platform === "darwin";

export function installAppMenu(opts: {
  openNewWindow: () => void;
  focusedWebContentsSend: (channel: string, payload?: unknown) => void;
}): void {
  const template: MenuItemConstructorOptions[] = [
    // macOS app menu (auto-hidden on win/linux).
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Settings…",
                accelerator: "Cmd+,",
                click: () =>
                  opts.focusedWebContentsSend(PushChannel.MenuNavigate, "/settings"),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),

    {
      label: "File",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: () =>
            opts.focusedWebContentsSend(PushChannel.MenuAction, "new-chat"),
        },
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => opts.openNewWindow(),
        },
        { type: "separator" },
        {
          label: "Search…",
          accelerator: "CmdOrCtrl+K",
          click: () =>
            opts.focusedWebContentsSend(PushChannel.MenuAction, "command-palette"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },

    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },

    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: (_m, win) => {
            if (!win) return;
            const w = win as BrowserWindow;
            void w.webContents.setZoomFactor(1);
            syncTrafficLight(w);
          },
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          click: (_m, win) => {
            if (!win) return;
            const w = win as BrowserWindow;
            // Discrete zoom steps: 0.85 / 1.0 / 1.15 / 1.3 / 1.5
            // Two zoom-in levels above default cover "I want it bigger"
            // and "I'm reading from across the room"; the rest of the
            // chrome stays visually proportional via syncTrafficLight.
            const STEPS = [0.85, 1.0, 1.15, 1.3, 1.5];
            const f = w.webContents.getZoomFactor();
            const next =
              STEPS.find((s) => s > f + 0.01) ?? STEPS[STEPS.length - 1]!;
            void w.webContents.setZoomFactor(next);
            syncTrafficLight(w);
          },
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: (_m, win) => {
            if (!win) return;
            const w = win as BrowserWindow;
            const STEPS = [0.85, 1.0, 1.15, 1.3, 1.5];
            const f = w.webContents.getZoomFactor();
            const next =
              [...STEPS].reverse().find((s) => s < f - 0.01) ?? STEPS[0]!;
            void w.webContents.setZoomFactor(next);
            syncTrafficLight(w);
          },
        },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },

    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ] satisfies MenuItemConstructorOptions[])
          : ([{ role: "close" }] satisfies MenuItemConstructorOptions[])),
      ],
    },

    {
      role: "help",
      submenu: [
        {
          label: "Backchat on GitHub",
          click: () =>
            void shell.openExternal("https://github.com/minimax/backchat"),
        },
        {
          label: "Agent Client Protocol docs",
          click: () => void shell.openExternal("https://agentclientprotocol.com"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Send a payload to whichever window the user has in focus. Falls back
 *  to the first window when nothing is focused (e.g. the menu fired
 *  from the dock with no active window — macOS). */
export function sendToFocused(channel: string, payload?: unknown): void {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}
