import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

type BridgeResponse = { ok: boolean; result?: unknown; error?: string };

describe("Chrome extension background worker", () => {
  it("exposes popup status and lets the user pause automation or change bridge port", async () => {
    const worker = loadBackgroundWorker();

    await expect(worker.sendMessage({ type: "bridge.status" })).resolves.toMatchObject({
      ok: true,
      result: {
        status: "disconnected",
        paused: false,
        bridgePort: 29174,
        extensionId: "ext-1",
        extensionVersion: "0.1.0",
        instanceId: "instance-1",
      },
    });

    await expect(worker.sendMessage({ type: "bridge.setPaused", paused: true }))
      .resolves.toEqual({ ok: true, result: null });
    await expect(worker.sendMessage({ type: "bridge.status" })).resolves.toMatchObject({
      ok: true,
      result: {
        status: "paused",
        paused: true,
      },
    });
    expect(worker.storageData.backchatBridgePaused).toBe(true);
    expect(worker.actionSetBadgeText).toHaveBeenCalledWith({ text: "PAUSE" });

    await expect(worker.sendMessage({ type: "bridge.setPort", port: 34567 }))
      .resolves.toEqual({ ok: true, result: null });
    await expect(worker.sendMessage({ type: "bridge.status" })).resolves.toMatchObject({
      ok: true,
      result: {
        bridgePort: 34567,
        status: "paused",
      },
    });
    expect(worker.storageData.backchatBridgePort).toBe(34567);
  });

  it("does not register or fetch commands while paused", async () => {
    const worker = loadBackgroundWorker({
      storage: { backchatBridgePaused: true },
    });

    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }

    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.actionSetBadgeText).toHaveBeenCalledWith({ text: "PAUSE" });
    await expect(worker.sendMessage({ type: "bridge.status" })).resolves.toMatchObject({
      ok: true,
      result: {
        status: "paused",
        paused: true,
      },
    });
  });

  it("captures default screenshots through CDP in CSS viewport pixels", async () => {
    const worker = loadBackgroundWorker();

    const response = await worker.sendCommand({
      id: "cmd-1",
      type: "tab.screenshot",
      tabId: "7",
    });

    expect(response).toEqual({
      ok: true,
      result: "data:image/jpeg;base64,viewport-shot",
    });
    expect(worker.captureVisibleTab).not.toHaveBeenCalled();
    expect(worker.debuggerSendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Emulation.setDeviceMetricsOverride",
      {
        width: 1265,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
      },
    );
    expect(worker.debuggerSendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.captureScreenshot",
      {
        format: "jpeg",
        quality: 85,
        clip: { x: 12, y: 34, width: 1265, height: 720, scale: 1 },
      },
    );
    expect(worker.debuggerSendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Emulation.clearDeviceMetricsOverride",
    );
  });

  it("captures full-page screenshots through CDP content dimensions", async () => {
    const worker = loadBackgroundWorker();

    const response = await worker.sendCommand({
      id: "cmd-2",
      type: "tab.screenshot",
      tabId: "7",
      options: { fullPage: true },
    });

    expect(response).toEqual({
      ok: true,
      result: "data:image/jpeg;base64,viewport-shot",
    });
    expect(worker.captureVisibleTab).not.toHaveBeenCalled();
    expect(worker.debuggerSendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Emulation.setDeviceMetricsOverride",
      {
        width: 1265,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
      },
    );
    expect(worker.debuggerSendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.captureScreenshot",
      {
        format: "jpeg",
        quality: 85,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 1265, height: 9000, scale: 1 },
      },
    );
    expect(worker.debuggerSendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Emulation.clearDeviceMetricsOverride",
    );
  });
});

function loadBackgroundWorker(options: {
  storage?: Record<string, unknown>;
} = {}) {
  let messageListener: ((message: unknown, sender: unknown, sendResponse: (response: BridgeResponse) => void) => true) | null = null;
  const storageData: Record<string, unknown> = {
    backchatInstanceId: "instance-1",
    ...(options.storage ?? {}),
  };
  const captureVisibleTab = vi.fn(async () => "data:image/jpeg;base64,visible-tab");
  const actionSetBadgeText = vi.fn(async () => undefined);
  const actionSetBadgeBackgroundColor = vi.fn(async () => undefined);
  const fetch = vi.fn(async () => {
    throw new Error("bridge offline");
  });
  const debuggerSendCommand = vi.fn(async (
    _target: { tabId: number },
    method: string,
  ) => {
    if (method === "Page.getLayoutMetrics") {
      return {
        cssLayoutViewport: {
          pageX: 12,
          pageY: 34,
          clientWidth: 1265,
          clientHeight: 720,
        },
        cssContentSize: {
          x: 0,
          y: 0,
          width: 1265,
          height: 7747,
        },
      };
    }
    if (method === "Page.captureScreenshot") {
      return { data: "viewport-shot" };
    }
    return {};
  });
  const chrome = {
    runtime: {
      id: "ext-1",
      getManifest: () => ({ version: "0.1.0" }),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: {
        addListener(listener: typeof messageListener) {
          messageListener = listener;
        },
      },
    },
    alarms: {
      onAlarm: { addListener: vi.fn() },
      clear: vi.fn((_name: string, callback?: () => void) => callback?.()),
      create: vi.fn(),
    },
    debugger: {
      onEvent: { addListener: vi.fn() },
      onDetach: { addListener: vi.fn() },
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: debuggerSendCommand,
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string[] | string) => {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storageData[key]]));
          }
          if (typeof keys === "string") return { [keys]: storageData[keys] };
          return { ...storageData };
        }),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(storageData, value);
        }),
      },
    },
    action: {
      setBadgeText: actionSetBadgeText,
      setBadgeBackgroundColor: actionSetBadgeBackgroundColor,
      setTitle: vi.fn(async () => undefined),
    },
    tabs: {
      captureVisibleTab,
      query: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 7, title: "New", url: "about:blank" })),
      update: vi.fn(async (_tabId: number, update: { url?: string }) => ({
        id: 7,
        status: "complete",
        title: "Page",
        url: update.url,
      })),
      get: vi.fn(async () => ({
        id: 7,
        status: "complete",
        title: "Page",
        url: "http://127.0.0.1:5173/",
      })),
      remove: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      goBack: vi.fn(async () => undefined),
      goForward: vi.fn(async () => undefined),
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    scripting: {
      executeScript: vi.fn(async () => [{
        result: {
          scrollX: 12,
          scrollY: 34,
          viewportWidth: 1265,
          viewportHeight: 720,
          documentWidth: 1265,
          documentHeight: 9000,
        },
      }]),
    },
    webNavigation: {
      getAllFrames: vi.fn(async () => []),
    },
  };
  const sandbox = {
    chrome,
    crypto: { randomUUID: () => "instance-1" },
    fetch,
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    AbortController,
    console,
  };

  vm.runInNewContext(
    readFileSync(resolve(__dirname, "../background.js"), "utf8"),
    sandbox,
    { filename: "background.js" },
  );

  if (!messageListener) {
    throw new Error("background worker did not register an onMessage listener");
  }

  return {
    captureVisibleTab,
    debuggerSendCommand,
    actionSetBadgeText,
    actionSetBadgeBackgroundColor,
    fetch,
    storageData,
    async sendMessage(message: unknown) {
      return new Promise<BridgeResponse>((resolveResponse) => {
        messageListener?.(message, {}, resolveResponse);
      });
    },
    async sendCommand(command: unknown) {
      return new Promise<BridgeResponse>((resolveResponse) => {
        messageListener?.({ type: "bridge.command", command }, {}, resolveResponse);
      });
    },
  };
}
