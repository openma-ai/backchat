import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { autoUpdater } from "electron-updater";
import {
  UPDATE_CHECK_INTERVAL_MS,
  appBundlePathFromExecutable,
  buildFromVersion,
  canInstallUpdate,
  electronUpdaterFeedOptions,
  feedForChannel,
  parseUpdateIdentity,
  shouldAutoAcceptUpdate,
  updateErrorCode,
  updateStartupDelayMs,
  type AppUpdateState,
  type AvailableUpdate,
  type UpdateIdentity,
} from "../shared/app-update.js";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import { logAppEvent } from "./app-log.js";
import { settingsStore } from "./settings-store.js";
import { recordUpdateEvidence } from "./update-evidence.js";

interface UpdateQuit {
  approve(): void;
  readonly pending: boolean;
}

/**
 * electron-updater feeds Squirrel.Mac a zip from the channel's `*-mac.yml`.
 * Squirrel checks the Developer ID signature, so ad-hoc builds can look for
 * an update but cannot install one. Quitting still goes through
 * QuitCoordinator, which disposes agent sessions and closes the control socket.
 */
export async function startAppUpdater(quit: UpdateQuit): Promise<() => void> {
  const version = app.getVersion();
  const identity = await readIdentity(version);
  const install = canInstallUpdate({
    platform: process.platform,
    packaged: app.isPackaged,
    signed: identity.signed,
    appBundlePath: appBundlePathFromExecutable(app.getPath("exe"), process.platform),
  });
  let state = initialState(version, identity, install);
  let prompted: string | null = null;
  let checking = false;

  const publish = (patch: Partial<AppUpdateState>): AppUpdateState => {
    state = { ...state, ...patch };
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
    return state;
  };

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

  autoUpdater.on("checking-for-update", () => {
    publish({ status: "checking", errorCode: null });
  });
  autoUpdater.on("update-available", (info) => {
    const available = availableFrom(info.version);
    publish({
      status: install.ok ? "downloading" : "available",
      available,
      errorCode: null,
      checkedAt: new Date().toISOString(),
    });
    if (install.ok) void autoUpdater.downloadUpdate();
  });
  autoUpdater.on("update-not-available", () => {
    publish({
      status: "upToDate",
      available: null,
      errorCode: null,
      checkedAt: new Date().toISOString(),
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    const available = availableFrom(info.version);
    publish({ status: "ready", available, errorCode: null });
    if (!install.ok) return;
    const key = available.version;
    if (prompted === key) return;
    prompted = key;
    void promptAndInstall();
  });
  autoUpdater.on("error", (error) => {
    checking = false;
    publish({
      status: "error",
      errorCode: updateErrorCode(error),
      checkedAt: new Date().toISOString(),
    });
  });

  nativeAutoUpdater.on("before-quit-for-update", () => {
    quit.approve();
  });

  async function check(): Promise<AppUpdateState> {
    if (!feed || identity.channel === "dev") return state;
    if (checking) return state;
    checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      publish({ status: "error", errorCode: updateErrorCode(error) });
    } finally {
      checking = false;
    }
    return state;
  }

  async function promptAndInstall(): Promise<AppUpdateState> {
    if (!install.ok || state.status !== "ready") return state;
    if (quit.pending) return state;
    if (!(await confirmUpdate(state))) return state;
    publish({ status: "installing", errorCode: null });
    recordUpdateEvidence("quit-and-install", { version: state.available?.version ?? "" });
    autoUpdater.quitAndInstall();
    return state;
  }

  ipcMain.handle(InvokeChannel.UpdateGetState, () => state);
  ipcMain.handle(InvokeChannel.UpdateCheck, () => check());
  ipcMain.handle(InvokeChannel.UpdateInstall, () => promptAndInstall());

  const timers: NodeJS.Timeout[] = [];
  const automatic = Boolean(feed) && app.isPackaged && process.env["BACKCHAT_DISABLE_UPDATE"] !== "1";
  if (automatic) {
    const startup = setTimeout(() => void check(), updateStartupDelayMs(process.env));
    startup.unref();
    const interval = setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
    interval.unref();
    timers.push(startup, interval);
  }

  return () => {
    for (const timer of timers) clearTimeout(timer);
    ipcMain.removeHandler(InvokeChannel.UpdateGetState);
    ipcMain.removeHandler(InvokeChannel.UpdateCheck);
    ipcMain.removeHandler(InvokeChannel.UpdateInstall);
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

function initialState(
  version: string,
  identity: UpdateIdentity,
  install: ReturnType<typeof canInstallUpdate>,
): AppUpdateState {
  return {
    version,
    channel: identity.channel,
    build: identity.build || buildFromVersion(version),
    commit: identity.commit,
    signed: identity.signed,
    status: "idle",
    canInstall: install.ok,
    installBlock: install.ok ? "none" : install.reason,
    available: null,
    errorCode: null,
    checkedAt: null,
  };
}

function availableFrom(version: string): AvailableUpdate {
  return { version, build: buildFromVersion(version), commit: "" };
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
