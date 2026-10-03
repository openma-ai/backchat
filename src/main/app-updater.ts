import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_STARTUP_DELAY_MS,
  appBundlePathFromExecutable,
  parseUpdateIdentity,
  type AppUpdateState,
} from "../shared/app-update.js";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import { logAppEvent } from "./app-log.js";
import { AppUpdateController } from "./app-update-controller.js";
import { readIdentityFile } from "./app-update-io.js";
import { settingsStore } from "./settings-store.js";

interface UpdateQuit {
  approve(): void;
  readonly pending: boolean;
}

/**
 * Checks GitHub Releases for a newer build of the same channel and, after the
 * user confirms, hands replacement to scripts/apply-mac-update.sh. The helper
 * is outside the bundle and waits until this process exits. Shutdown goes
 * through the normal quit barrier, which disposes agent sessions and closes
 * the local control socket before the process actually ends.
 */
export async function startAppUpdater(quit: UpdateQuit): Promise<() => void> {
  const version = app.getVersion();
  const identity = await readIdentityFile(metadataPath(), version).catch((error: unknown) => {
    logAppEvent("app.update", {
      status: "error",
      error: error instanceof Error ? error.message : "metadata",
    });
    return parseUpdateIdentity(undefined, version);
  });
  const controller = new AppUpdateController({
    identity,
    platform: process.platform,
    packaged: app.isPackaged,
    appBundlePath: appBundlePathFromExecutable(app.getPath("exe"), process.platform),
    userDataPath: app.getPath("userData"),
    env: process.env,
  });

  let prompted: string | null = null;
  let prompting = false;

  const broadcast = (state: AppUpdateState): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(PushChannel.UpdateState, state);
      }
    }
  };

  controller.subscribe((state) => {
    broadcast(state);
    logAppEvent("app.update", {
      status: state.status,
      channel: state.channel,
      version: state.available?.version ?? state.version,
      build: state.available?.build ?? state.build,
      error: state.errorCode,
    });
    if (state.status !== "ready" || !state.canInstall || !state.available) return;
    const key = `${state.available.version}+${state.available.build}`;
    if (prompted === key || prompting) return;
    prompted = key;
    void promptAndInstall();
  });

  async function promptAndInstall(): Promise<AppUpdateState> {
    if (prompting) return controller.state;
    prompting = true;
    try {
      const updates = join(app.getPath("userData"), "updates");
      await mkdir(updates, { recursive: true });
      const scriptPath = join(updates, "apply-mac-update.sh");
      await copyFile(bundledScriptPath(), scriptPath);
      await chmod(scriptPath, 0o755);
      return await controller.install({
        confirm: () => confirmUpdate(controller.state),
        quitInProgress: () => quit.pending,
        spawn(request) {
          const child = spawn("/bin/bash", AppUpdateController.helperArgs(request), {
            detached: true,
            stdio: "ignore",
          });
          child.unref();
        },
        shutdown() {
          quit.approve();
          app.quit();
        },
        scriptPath,
        pid: process.pid,
        backupPath: join(updates, "Backchat.app.previous"),
        logPath: join(updates, "apply.log"),
      });
    } catch (error) {
      logAppEvent("app.update", {
        status: "error",
        error: error instanceof Error ? error.message : "install",
      });
      return controller.failInstall();
    } finally {
      prompting = false;
    }
  }

  ipcMain.handle(InvokeChannel.UpdateGetState, () => controller.state);
  ipcMain.handle(InvokeChannel.UpdateCheck, () => controller.check());
  ipcMain.handle(InvokeChannel.UpdateInstall, () => promptAndInstall());

  const timers: NodeJS.Timeout[] = [];
  const automatic =
    app.isPackaged &&
    process.platform === "darwin" &&
    identity.channel !== "dev" &&
    process.env["BACKCHAT_DISABLE_UPDATE"] !== "1";
  if (automatic) {
    const startup = setTimeout(() => {
      void controller.check();
    }, UPDATE_STARTUP_DELAY_MS);
    startup.unref();
    const interval = setInterval(() => {
      void controller.check();
    }, UPDATE_CHECK_INTERVAL_MS);
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

function metadataPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "update-metadata.json");
  return join(app.getAppPath(), "build", "update-metadata.json");
}

function bundledScriptPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "apply-mac-update.sh");
  return join(app.getAppPath(), "scripts", "apply-mac-update.sh");
}

function prefersChinese(): boolean {
  const language = settingsStore.get().appearance.language;
  return language === "zh-CN" || (language === "system" && app.getLocale().startsWith("zh"));
}

async function confirmUpdate(state: AppUpdateState): Promise<boolean> {
  const version = state.available?.version ?? state.version;
  const zh = prefersChinese();
  const result = await dialog.showMessageBox({
    type: "info",
    title: zh ? "重启并更新" : "Restart and update",
    message: zh ? `更新到 ${version}？` : `Update to ${version}?`,
    detail: zh
      ? "Backchat 会退出，并用已下载的版本替换 /Applications 里的 Backchat.app。正在运行的 Agent 会停止，本地控制服务会关闭。如果替换失败，会恢复当前版本并重新打开。"
      : "Backchat will quit and replace Backchat.app in /Applications with the downloaded version. Running agents will stop, and the local control socket will close. If replacement fails, the current version is restored and reopened.",
    buttons: zh ? ["稍后", "重启并更新"] : ["Later", "Restart and update"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}
