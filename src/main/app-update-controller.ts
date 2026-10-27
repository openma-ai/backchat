/**
 * The App update state machine.
 *
 * The App update is deliberately a three-step flow:
 *
 *   1. check    — discovers a newer build and stops there
 *   2. download — the user asks for the bytes
 *   3. restart  — the user asks for the install
 *
 * Step 1 must never fall into step 2, and step 2 must never fall into step
 * 3. Both edges used to exist: `update-available` kicked off
 * `downloadUpdate()`, and `update-downloaded` opened the install prompt on
 * its own, so "Check for updates" turned into a silent download followed by
 * a surprise restart dialog. The rule here is that every state transition
 * past "available" is caused by an explicit user action.
 *
 * The controller owns no Electron APIs, so the whole flow is unit-testable
 * against a fake updater.
 */

import {
  buildFromVersion,
  updateErrorCode,
  updateProgressFromInfo,
  type AppUpdateState,
  type AvailableUpdate,
  type ElectronUpdaterFeedOptions,
  type UpdateFeed,
  type UpdateIdentity,
  type UpdateInstallBlock,
  type UpdateProgress,
  type UpdateProgressInfo,
} from "../shared/app-update.js";

/** The subset of `electron-updater`'s AutoUpdater this controller drives. */
export interface ControllerAutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  channel?: string | null;
  setFeedURL(options: ElectronUpdaterFeedOptions): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: "checking-for-update", listener: () => void): void;
  on(event: "update-available", listener: (info: { version: string }) => void): void;
  on(event: "update-not-available", listener: () => void): void;
  on(event: "update-downloaded", listener: (info: { version: string }) => void): void;
  on(event: "download-progress", listener: (progress: UpdateProgressInfo) => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
}

export type UpdateInstallVerdict =
  | { ok: true }
  | { ok: false; reason: Exclude<UpdateInstallBlock, "none"> };

export interface AppUpdateControllerDeps {
  version: string;
  identity: UpdateIdentity;
  install: UpdateInstallVerdict;
  /** Null on dev builds — nothing to check against. */
  feed: UpdateFeed | null;
  autoUpdater: ControllerAutoUpdater;
  /** Called with the full state after every transition. */
  publish: (state: AppUpdateState) => void;
  /** Asks the user to confirm the restart. Resolving false aborts it. */
  confirmInstall: (state: AppUpdateState) => Promise<boolean>;
  /** True while the app is already tearing down for an update. */
  quitPending: () => boolean;
  /** Called just before the app quits to install. */
  onInstallRequested?: (version: string) => void;
}

export interface AppUpdateController {
  getState(): AppUpdateState;
  /** Step 1. Discovery only — never downloads. */
  check(): Promise<AppUpdateState>;
  /** Step 2. Downloads the discovered update. */
  download(): Promise<AppUpdateState>;
  /** Step 3. Quits and installs the downloaded update. */
  install(): Promise<AppUpdateState>;
}

export function createAppUpdateController(
  deps: AppUpdateControllerDeps,
): AppUpdateController {
  let state: AppUpdateState = {
    version: deps.version,
    channel: deps.identity.channel,
    build: deps.identity.build || buildFromVersion(deps.version),
    commit: deps.identity.commit,
    signed: deps.identity.signed,
    status: "idle",
    canInstall: deps.install.ok,
    installBlock: deps.install.ok ? "none" : deps.install.reason,
    available: null,
    errorCode: null,
    checkedAt: null,
    progress: null,
  };
  let checking = false;
  let downloading = false;

  const update = (patch: Partial<AppUpdateState>): AppUpdateState => {
    state = { ...state, ...patch };
    deps.publish(state);
    return state;
  };

  deps.autoUpdater.on("checking-for-update", () => {
    update({ status: "checking", errorCode: null });
  });

  // Discovery only. The download waits for an explicit user action.
  deps.autoUpdater.on("update-available", (info) => {
    update({
      status: "available",
      available: availableFrom(info.version),
      errorCode: null,
      checkedAt: new Date().toISOString(),
      progress: null,
    });
  });

  deps.autoUpdater.on("update-not-available", () => {
    update({
      status: "upToDate",
      available: null,
      errorCode: null,
      checkedAt: new Date().toISOString(),
      progress: null,
    });
  });

  deps.autoUpdater.on("download-progress", (progress) => {
    update({ status: "downloading", progress: updateProgressFromInfo(progress) });
  });

  // Ready to install — but the install still waits for an explicit restart.
  deps.autoUpdater.on("update-downloaded", (info) => {
    update({
      status: "ready",
      available: availableFrom(info.version),
      errorCode: null,
      progress: null,
    });
  });

  deps.autoUpdater.on("error", (error) => {
    checking = false;
    downloading = false;
    update({
      status: "error",
      errorCode: updateErrorCode(error),
      checkedAt: new Date().toISOString(),
      progress: null,
    });
  });

  async function check(): Promise<AppUpdateState> {
    if (!deps.feed || deps.identity.channel === "dev") return state;
    if (checking) return state;
    checking = true;
    update({ status: "checking", errorCode: null });
    try {
      await deps.autoUpdater.checkForUpdates();
    } catch (error) {
      update({ status: "error", errorCode: updateErrorCode(error) });
    } finally {
      checking = false;
    }
    return state;
  }

  async function download(): Promise<AppUpdateState> {
    if (!deps.feed) return state;
    // A build that cannot install the update has no reason to fetch it.
    if (!deps.install.ok) return state;
    if (downloading) return state;
    if (state.status === "downloading" || state.status === "ready") return state;
    if (!state.available) return state;
    downloading = true;
    update({
      status: "downloading",
      errorCode: null,
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
    });
    try {
      await deps.autoUpdater.downloadUpdate();
    } catch (error) {
      update({ status: "error", errorCode: updateErrorCode(error), progress: null });
    } finally {
      downloading = false;
    }
    return state;
  }

  async function install(): Promise<AppUpdateState> {
    if (!deps.install.ok || state.status !== "ready") return state;
    if (deps.quitPending()) return state;
    if (!(await deps.confirmInstall(state))) return state;
    update({ status: "installing", errorCode: null });
    deps.onInstallRequested?.(state.available?.version ?? state.version);
    deps.autoUpdater.quitAndInstall();
    return state;
  }

  return {
    getState: () => state,
    check,
    download,
    install,
  };
}

function availableFrom(version: string): AvailableUpdate {
  return { version, build: buildFromVersion(version), commit: "" };
}
