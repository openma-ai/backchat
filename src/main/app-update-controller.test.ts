import { describe, expect, it, vi } from "vitest";
import {
  createAppUpdateController,
  type AppUpdateControllerDeps,
  type ControllerAutoUpdater,
} from "./app-update-controller.js";
import type { AppUpdateState, UpdateFeed } from "../shared/app-update.js";

/** A fake electron-updater that lets a test fire the events for real. */
class FakeAutoUpdater {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = false;
  allowPrerelease = false;
  channel: string | null = null;
  setFeedURL = vi.fn();
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();

  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  on(event: string, listener: (payload: unknown) => void): void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
  }
}

const feed: UpdateFeed = {
  url: "https://github.com/openma-ai/backchat/releases/latest/download",
  channel: "latest",
  fileName: "latest-mac.yml",
  allowPrerelease: false,
};

function harness(overrides: Partial<AppUpdateControllerDeps> = {}) {
  const autoUpdater = new FakeAutoUpdater();
  const published: AppUpdateState[] = [];
  const confirmInstall = vi.fn(async () => true);
  const deps: AppUpdateControllerDeps = {
    version: "1.0.0",
    identity: {
      version: "1.0.0",
      channel: "stable",
      build: 0,
      commit: "",
      signed: true,
    },
    install: { ok: true },
    feed,
    autoUpdater: autoUpdater as unknown as ControllerAutoUpdater,
    publish: (state) => published.push(state),
    confirmInstall,
    quitPending: () => false,
    ...overrides,
  };
  const controller = createAppUpdateController(deps);
  return { controller, autoUpdater, published, confirmInstall };
}

describe("app update controller", () => {
  it("a check discovers the update and never downloads it", async () => {
    const { controller, autoUpdater, published } = harness();

    await controller.check();
    autoUpdater.emit("update-available", { version: "1.1.0" });

    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("available");
    expect(controller.getState().available?.version).toBe("1.1.0");
    expect(published.map((state) => state.status)).not.toContain("downloading");
  });

  it("the download is a separate, explicit action", async () => {
    const { controller, autoUpdater } = harness();

    await controller.check();
    autoUpdater.emit("update-available", { version: "1.1.0" });
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();

    await controller.download();

    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("downloading");
  });

  it("download progress reaches the shared state", async () => {
    const { controller, autoUpdater } = harness();

    await controller.check();
    autoUpdater.emit("update-available", { version: "1.1.0" });
    await controller.download();
    autoUpdater.emit("download-progress", {
      percent: 42.4,
      transferred: 420,
      total: 1000,
      bytesPerSecond: 4096,
    });

    expect(controller.getState().status).toBe("downloading");
    expect(controller.getState().progress).toEqual({
      percent: 42,
      transferred: 420,
      total: 1000,
      bytesPerSecond: 4096,
    });
  });

  it("a downloaded update waits for an explicit restart", async () => {
    const { controller, autoUpdater, confirmInstall } = harness();

    await controller.check();
    autoUpdater.emit("update-available", { version: "1.1.0" });
    await controller.download();
    autoUpdater.emit("update-downloaded", { version: "1.1.0" });

    expect(controller.getState().status).toBe("ready");
    expect(controller.getState().progress).toBeNull();
    expect(confirmInstall).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("the restart action installs the downloaded update", async () => {
    const { controller, autoUpdater, confirmInstall } = harness();

    await controller.check();
    autoUpdater.emit("update-available", { version: "1.1.0" });
    await controller.download();
    autoUpdater.emit("update-downloaded", { version: "1.1.0" });

    await controller.install();

    expect(confirmInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("installing");
  });

  it("the restart action does nothing before an update is ready", async () => {
    const { controller, autoUpdater, confirmInstall } = harness();

    await controller.check();
    autoUpdater.emit("update-available", { version: "1.1.0" });
    await controller.install();

    expect(confirmInstall).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("a declined confirmation leaves the update ready to install", async () => {
    const confirmInstall = vi.fn(async () => false);
    const { controller, autoUpdater } = harness({ confirmInstall });

    await controller.check();
    autoUpdater.emit("update-available", { version: "1.1.0" });
    await controller.download();
    autoUpdater.emit("update-downloaded", { version: "1.1.0" });

    await controller.install();

    expect(confirmInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("ready");
  });

  it("a build that cannot install updates never downloads one", async () => {
    const { controller, autoUpdater } = harness({
      install: { ok: false, reason: "unsigned" },
    });

    await controller.check();
    autoUpdater.emit("update-available", { version: "1.1.0" });
    await controller.download();

    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("available");
    expect(controller.getState().canInstall).toBe(false);
  });

  it("a second download request does not start a second download", async () => {
    const { controller, autoUpdater } = harness();

    await controller.check();
    autoUpdater.emit("update-available", { version: "1.1.0" });

    await Promise.all([controller.download(), controller.download()]);

    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("a dev channel has no feed, so a check is a no-op", async () => {
    const { controller, autoUpdater } = harness({
      feed: null,
      identity: {
        version: "1.0.0",
        channel: "dev",
        build: 0,
        commit: "",
        signed: false,
      },
    });

    await controller.check();

    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("idle");
  });

  it("reports a failed check instead of leaving the status stuck", async () => {
    const { controller, autoUpdater } = harness();
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error("network down"));

    await controller.check();

    expect(controller.getState().status).toBe("error");
    expect(controller.getState().errorCode).toBe("network");
  });
});
