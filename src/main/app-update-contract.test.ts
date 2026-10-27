import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The App update is check → download → restart, and each step waits for the
 * user. These assertions guard the seams where that used to break: the
 * updater reaching for the download on its own, and the downloaded update
 * installing itself.
 */
const updaterSource = readFileSync(
  resolve(__dirname, "app-updater.ts"),
  "utf8",
);
const controllerSource = readFileSync(
  resolve(__dirname, "app-update-controller.ts"),
  "utf8",
);
const menuSource = readFileSync(resolve(__dirname, "menu.ts"), "utf8");

describe("app update flow contract", () => {
  it("never lets the updater download on its own", () => {
    expect(updaterSource).toContain("autoUpdater.autoDownload = false;");
    expect(updaterSource).not.toContain("autoUpdater.downloadUpdate(");
    expect(updaterSource).not.toContain("autoUpdater.autoInstallOnAppQuit = true;");
  });

  it("never lets a downloaded update install itself", () => {
    expect(updaterSource).not.toContain("promptAndInstall");
    expect(controllerSource).not.toContain("promptAndInstall");
    // The install is reachable only through the explicit restart action.
    expect(controllerSource).toContain("autoUpdater.quitAndInstall()");
  });

  it("keeps the download on its own IPC channel", () => {
    expect(updaterSource).toContain("ipcMain.handle(InvokeChannel.UpdateDownload");
    expect(updaterSource).toContain("ipcMain.handle(InvokeChannel.UpdateCheck");
    expect(updaterSource).toContain("ipcMain.handle(InvokeChannel.UpdateInstall");
  });

  it("keeps the background scheduler on the check-only path", () => {
    expect(updaterSource).toContain("void controller.check()");
    expect(updaterSource).not.toContain("void controller.download()");
  });

  it("offers a menu item that only checks", () => {
    expect(menuSource).toContain("Check for Updates…");
    expect(menuSource).toContain("click: () => opts.checkForUpdates()");
  });
});
