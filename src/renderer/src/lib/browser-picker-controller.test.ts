import { describe, expect, it, vi } from "vitest";

import { BrowserPickerController } from "./browser-picker-controller";

function createHarness() {
  const target = {
    webContentsId: 42,
    sessionId: "session-1",
  };
  const regionResult = {
    screenshotData: "region",
    region: {
      url: "https://example.test",
      title: "Example",
      rect: { x: 1, y: 2, width: 30, height: 40 },
      viewport: { width: 800, height: 600, device_pixel_ratio: 1 },
    },
  };
  const api = {
    begin: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(null),
    commit: vi.fn().mockResolvedValue(null),
    captureRegion: vi.fn().mockResolvedValue(regionResult),
  };
  const onPickingChange = vi.fn();
  const onHover = vi.fn();
  const onError = vi.fn();
  const onElementResult = vi.fn().mockResolvedValue(undefined);
  const onRegionResult = vi.fn().mockResolvedValue(undefined);
  const onRefreshSnapshot = vi.fn();
  let scheduledFrame: (() => void) | undefined;
  const scheduleFrame = vi.fn((callback: () => void) => {
    scheduledFrame = callback;
    return 1;
  });
  const cancelFrame = vi.fn();
  const getTarget = vi.fn(() => target);
  const controller = new BrowserPickerController({
    api,
    getTarget,
    scheduleFrame,
    cancelFrame,
    onPickingChange,
    onHover,
    onElementResult,
    onRegionResult,
    onRefreshSnapshot,
    onError,
  });
  return {
    api,
    cancelFrame,
    controller,
    flushFrame: () => {
      const callback = scheduledFrame;
      scheduledFrame = undefined;
      callback?.();
    },
    getTarget,
    onHover,
    onPickingChange,
    onError,
    onElementResult,
    scheduleFrame,
    target,
    onRegionResult,
    onRefreshSnapshot,
    regionResult,
  };
}

describe("BrowserPickerController", () => {
  it("begins a picker for the current browser target", async () => {
    const { api, controller, onHover, onPickingChange } = createHarness();

    await expect(controller.begin()).resolves.toBe(true);

    expect(api.begin).toHaveBeenCalledWith({ webContentsId: 42 });
    expect(onHover).toHaveBeenCalledWith(null);
    expect(onPickingChange).toHaveBeenCalledWith(true);
    expect(controller.isPicking()).toBe(true);
  });

  it("reports a begin failure without leaving the picker active", async () => {
    const { api, controller, onError, onPickingChange } = createHarness();
    const error = new Error("Debugger is already attached");
    api.begin.mockRejectedValueOnce(error);

    await expect(controller.begin()).resolves.toBe(false);

    expect(onError).toHaveBeenCalledWith("begin", error);
    expect(onPickingChange).toHaveBeenLastCalledWith(false);
    expect(controller.isPicking()).toBe(false);
  });

  it("reports a target lookup failure as a begin error", async () => {
    const {
      controller,
      getTarget,
      onError,
      onPickingChange,
    } = createHarness();
    const error = new Error("Guest is not ready");
    getTarget.mockImplementationOnce(() => {
      throw error;
    });

    await expect(controller.begin()).resolves.toBe(false);

    expect(onError).toHaveBeenCalledWith("begin", error);
    expect(onPickingChange).toHaveBeenLastCalledWith(false);
  });

  it("cancels the active picker and clears its visible state", async () => {
    const { api, controller, onHover, onPickingChange } = createHarness();
    await controller.begin();

    await controller.cancel();

    expect(api.cancel).toHaveBeenCalledWith({ webContentsId: 42 });
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(onPickingChange).toHaveBeenLastCalledWith(false);
    expect(controller.isPicking()).toBe(false);
  });

  it("keeps a delayed begin cancelled when cancellation happens first", async () => {
    const { api, controller, onPickingChange } = createHarness();
    let finishBegin: (() => void) | undefined;
    api.begin.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishBegin = resolve;
      }),
    );
    const beginning = controller.begin();
    await Promise.resolve();

    await controller.cancel();
    finishBegin?.();

    await expect(beginning).resolves.toBe(false);
    expect(api.cancel).toHaveBeenCalledWith({ webContentsId: 42 });
    expect(onPickingChange).toHaveBeenLastCalledWith(false);
    expect(controller.isPicking()).toBe(false);
  });

  it("coalesces concurrent begin calls for the same browser target", async () => {
    const { api, controller } = createHarness();
    let finishBegin: (() => void) | undefined;
    api.begin.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishBegin = resolve;
      }),
    );

    const firstBegin = controller.begin();
    const secondBegin = controller.begin();

    await Promise.resolve();
    expect(api.begin).toHaveBeenCalledOnce();
    finishBegin?.();

    await expect(firstBegin).resolves.toBe(true);
    await expect(secondBegin).resolves.toBe(true);
    expect(api.cancel).not.toHaveBeenCalled();
    expect(controller.isPicking()).toBe(true);
  });

  it("coalesces hover points into one frame using the latest position", async () => {
    const {
      api,
      controller,
      flushFrame,
      onHover,
      scheduleFrame,
    } = createHarness();
    const hover = {
      selector: "#save",
      tag_name: "button",
      rect: { x: 1, y: 2, width: 100, height: 40 },
      label: "#save  100x40",
    };
    api.hover.mockResolvedValueOnce(hover);
    await controller.begin();

    controller.requestHover({ x: 10, y: 20 });
    controller.requestHover({ x: 30, y: 40 });
    expect(scheduleFrame).toHaveBeenCalledOnce();
    expect(api.hover).not.toHaveBeenCalled();
    flushFrame();

    expect(api.hover).toHaveBeenCalledWith({
      webContentsId: 42,
      x: 30,
      y: 40,
    });
    await vi.waitFor(() => {
      expect(onHover).toHaveBeenLastCalledWith(hover);
    });
  });

  it("commits an element and restarts the picker", async () => {
    const {
      api,
      controller,
      onElementResult,
      onRefreshSnapshot,
    } = createHarness();
    const hover = {
      selector: "#save",
      tag_name: "button",
      rect: { x: 1, y: 2, width: 100, height: 40 },
      label: "#save  100x40",
    };
    const result = {
      screenshotData: "png",
      element: {
        url: "https://example.test",
        title: "Example",
        selector: "#save",
        tag_name: "button",
        class_names: [],
        attributes: {},
        rect: hover.rect,
        viewport: { width: 800, height: 600, device_pixel_ratio: 1 },
      },
    };
    api.hover.mockResolvedValueOnce(hover);
    api.commit.mockResolvedValueOnce(result);
    await controller.begin();

    await controller.commit({ x: 20, y: 30 });

    expect(api.hover).toHaveBeenCalledWith({
      webContentsId: 42,
      x: 20,
      y: 30,
    });
    expect(api.commit).toHaveBeenCalledWith({ webContentsId: 42 });
    expect(onElementResult).toHaveBeenCalledWith("session-1", result);
    expect(onRefreshSnapshot).toHaveBeenCalledOnce();
    expect(api.begin).toHaveBeenCalledTimes(2);
    expect(controller.isPicking()).toBe(true);
  });

  it("captures a region and restarts the picker", async () => {
    const {
      api,
      controller,
      onRefreshSnapshot,
      onRegionResult,
      regionResult,
    } = createHarness();
    await controller.begin();
    const rect = { x: 5, y: 6, width: 70, height: 80 };

    await controller.captureRegion(rect);

    expect(api.captureRegion).toHaveBeenCalledWith({
      webContentsId: 42,
      rect,
    });
    expect(onRegionResult).toHaveBeenCalledWith("session-1", regionResult);
    expect(onRefreshSnapshot).toHaveBeenCalledOnce();
    expect(api.begin).toHaveBeenCalledTimes(2);
    expect(controller.isPicking()).toBe(true);
  });

  it("disposes the active picker and its pending hover frame", async () => {
    const {
      api,
      cancelFrame,
      controller,
      onPickingChange,
    } = createHarness();
    await controller.begin();
    controller.requestHover({ x: 10, y: 20 });

    await controller.dispose();

    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(api.cancel).toHaveBeenCalledWith({ webContentsId: 42 });
    expect(onPickingChange).toHaveBeenLastCalledWith(false);
    expect(controller.isPicking()).toBe(false);
  });

  it("can begin again after a StrictMode cleanup cycle", async () => {
    const { api, controller } = createHarness();
    await controller.begin();
    await controller.dispose();

    await expect(controller.begin()).resolves.toBe(true);

    expect(api.begin).toHaveBeenCalledTimes(2);
    expect(controller.isPicking()).toBe(true);
  });
});
