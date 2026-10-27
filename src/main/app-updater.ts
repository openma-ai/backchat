import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { autoUpdater } from "electron-updater";
import {
  UPDATE_CHECK_INTERVAL_MS,
  appBundlePathFromExecutable,
  canInstallUpdate,
  electronUpdaterFeedOptions,
  feedForChannel,
  parseUpdateIdentity,
  shouldAutoAcceptUpdate,
  updateStartupDelayMs,
  type AppUpdateState,
  type UpdateIdentity,
} from "../shared/app-update.js";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import { logAppEvent } from "./app-log.js";
import { settingsStore } from "./settings-store.js";
import { recordUpdateEvidence } from "./update-evidence.js";
import {
  createAppUpdateController,
  type ControllerAutoUpdater,
} from "./app-update-controller.js";

interface UpdateQuit {
  approve(): void;
  readonly pending: boolean;
}

/** Handle the rest of the app uses to drive the updater without Electron. */
export interface AppUpdaterHandle {
  /** Stop the background timers and drop the IPC handlers. */
  dispose: () => void;
  /** Step 1 — discovery only. Used by the "Check for Updates…" menu item. */
  checkForUpdates: () => Promise<AppUpdateState>;
  getState: () => AppUpdateState;
}

/**
 * electron-updater feeds Squirrel.Mac a zip from the channel's `*-mac.yml`.
 * Squirrel checks the Developer ID signature, so ad-hoc builds can look for
 * an update but cannot install one. Quitting still goes through
 * QuitCoordinator, which disposes agent sessions and closes the control socket.
 *
 * The flow is check → download → restart, and each step waits for the user.
 * See `app-update-controller.ts` for why the edges are cut that way.
 */
export async function startAppUpdater(quit: UpdateQuit): Promise<AppUpdaterHandle> {
  const version = app.getVersion();
  const identity = await readIdentity(version);
  const install = canInstallUpdate({
    platform: process.platform,
    packaged: app.isPackaged,
    signed: identity.signed,
    appBundlePath: appBundlePathFromExecutable(app.getPath("exe"), process.platform),
  });
  const feed = feedForChannel(identity.channel, process.env);

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  if (process.env["BACKCHAT_UPDATE_E2E"] === "1") {
    const write = (level: "log" | "warn" | "error", message?: unknown) => {
      console[level](`[updater] ${String(message)}`);
    };
    autoUpdater.logger = {
      info: (message?: unknown) => write("log", message),
      warn: (message?: unknown) => write("warn", message),
      error: (message?: unknown) => write("error", message),
      debug: (message?: string) => write("log", message),
    };
  }
  if (feed) {
    autoUpdater.setFeedURL(electronUpdaterFeedOptions(feed));
    autoUpdater.channel = feed.channel;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = feed.allowPrerelease;
  }

  const publish = (state: AppUpdateState): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(PushChannel.UpdateState, state);
    }
    logAppEvent("app.update", {
      status: state.status,
      channel: state.channel,
      version: state.available?.version ?? state.version,
      error: state.errorCode,
    });
    recordUpdateEvidence("update-state", {
      status: state.status,
      installBlock: state.installBlock,
      canInstall: state.canInstall,
      version: state.version,
      available: state.available?.version ?? "",
      errorCode: state.errorCode ?? "",
    });
  };

  const controller = createAppUpdateController({
    version,
    identity,
    install,
    feed,
    autoUpdater: autoUpdater as unknown as ControllerAutoUpdater,
    publish,
    confirmInstall: confirmUpdate,
    quitPending: () => quit.pending,
    onInstallRequested: (installVersion) => {
      recordUpdateEvidence("quit-and-install", { version: installVersion });
    },
  });

  nativeAutoUpdater.on("before-quit-for-update", () => {
    quit.approve();
  });

  ipcMain.handle(InvokeChannel.UpdateGetState, () => controller.getState());
  ipcMain.handle(InvokeChannel.UpdateCheck, () => controller.check());
  ipcMain.handle(InvokeChannel.UpdateDownload, () => controller.download());
  ipcMain.handle(InvokeChannel.UpdateInstall, () => controller.install());

  const timers: NodeJS.Timeout[] = [];
  const automatic = Boolean(feed) && app.isPackaged && process.env["BACKCHAT_DISABLE_UPDATE"] !== "1";
  if (automatic) {
    // Background checks discover updates; they never download them.
    const startup = setTimeout(() => void controller.check(), updateStartupDelayMs(process.env));
    startup.unref();
    const interval = setInterval(() => void controller.check(), UPDATE_CHECK_INTERVAL_MS);
    interval.unref();
    timers.push(startup, interval);
  }

  return {
    dispose: () => {
      for (const timer of timers) clearTimeout(timer);
      ipcMain.removeHandler(InvokeChannel.UpdateGetState);
      ipcMain.removeHandler(InvokeChannel.UpdateCheck);
      ipcMain.removeHandler(InvokeChannel.UpdateDownload);
      ipcMain.removeHandler(InvokeChannel.UpdateInstall);
    },
    checkForUpdates: () => controller.check(),
    getState: () => controller.getState(),
  };
}

async function readIdentity(version: string): Promise<UpdateIdentity> {
  try {
    const text = await readFile(metadataPath(), "utf8");
    return parseUpdateIdentity(JSON.parse(text) as unknown, version);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && !(error instanceof SyntaxError)) {
      logAppEvent("app.update", {
        status: "error",
        error: error instanceof Error ? error.message : "metadata",
      });
    }
    return parseUpdateIdentity(undefined, version);
  }
}

function metadataPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "update-metadata.json");
  return join(app.getAppPath(), "build", "update-metadata.json");
}

function prefersChinese(): boolean {
  const language = settingsStore.get().appearance.language;
  return language === "zh-CN" || (language === "system" && app.getLocale().startsWith("zh"));
}

async function confirmUpdate(state: AppUpdateState): Promise<boolean> {
  const version = state.available?.version ?? state.version;
  if (shouldAutoAcceptUpdate(process.env)) {
    recordUpdateEvidence("update-accepted", { version, mode: "test-hook" });
    return true;
  }
  const zh = prefersChinese();
  const result = await dialog.showMessageBox({
    type: "info",
    title: zh ? "重启并更新" : "Restart and update",
    message: zh ? `更新到 ${version}？` : `Update to ${version}?`,
    detail: zh
      ? "Backchat 会退出，并由系统安装程序替换 /Applications 里的 Backchat.app。正在运行的 Agent 会停止，本地控制服务会关闭。"
      : "Backchat will quit and the system updater will replace Backchat.app in /Applications. Running agents will stop, and the local control socket will close.",
    buttons: zh ? ["稍后", "重启并更新"] : ["Later", "Restart and update"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}
