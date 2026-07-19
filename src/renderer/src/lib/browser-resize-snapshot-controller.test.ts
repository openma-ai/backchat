import { describe, expect, it, vi } from "vitest";

import { BrowserResizeSnapshotController } from "./browser-resize-snapshot-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createHarness(cachedSnapshot: string | null = null) {
  const timers = new Map<number, () => void>();
  let nextTimerId = 1;
  const capture = vi.fn<() => Promise<string | null>>();
  const cancelPicker = vi.fn();
  const onSnapshot = vi.fn();
  const onCacheSnapshot = vi.fn();
  const controller = new BrowserResizeSnapshotController({
    settleMs: 180,
    capture,
    getCachedSnapshot: () => cachedSnapshot,
    onCacheSnapshot,
    cancelPicker,
    onSnapshot,
    scheduleTimeout: (callback) => {
      const timerId = nextTimerId++;
      timers.set(timerId, callback);
      return timerId;
    },
    cancelTimeout: (timerId) => {
      timers.delete(timerId);
    },
  });

  return {
    controller,
    capture,
    cancelPicker,
    onSnapshot,
    onCacheSnapshot,
    timers,
    runOnlyTimer() {
      expect(timers.size).toBe(1);
      const [timerId, callback] = [...timers.entries()][0];
      timers.delete(timerId);
      callback();
    },
  };
}

describe("BrowserResizeSnapshotController", () => {
  it("shows the cached frame immediately and coalesces repeated resize events", async () => {
    const harness = createHarness("data:image/png;base64,cached");
    harness.capture.mockResolvedValue("data:image/png;base64,settled");

    harness.controller.resize();
    harness.controller.resize();

    expect(harness.cancelPicker).toHaveBeenCalledTimes(1);
    expect(harness.onSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.onSnapshot).toHaveBeenCalledWith("data:image/png;base64,cached");
    expect(harness.timers.size).toBe(1);

    harness.runOnlyTimer();
    await Promise.resolve();

    expect(harness.onSnapshot).toHaveBeenLastCalledWith(null);
    expect(harness.onCacheSnapshot).toHaveBeenCalledWith(
      "data:image/png;base64,settled",
    );
  });

  it("uses an async capture when no cached frame exists", async () => {
    const firstCapture = deferred<string | null>();
    const settledCapture = deferred<string | null>();
    const harness = createHarness();
    harness.capture
      .mockReturnValueOnce(firstCapture.promise)
      .mockReturnValueOnce(settledCapture.promise);

    harness.controller.resize();
    firstCapture.resolve("data:image/png;base64,live");
    await firstCapture.promise;
    await Promise.resolve();

    expect(harness.onSnapshot).toHaveBeenCalledWith(
      "data:image/png;base64,live",
    );

    harness.runOnlyTimer();
    settledCapture.resolve("data:image/png;base64,settled");
    await settledCapture.promise;
    await Promise.resolve();

    expect(harness.onSnapshot).toHaveBeenLastCalledWith(null);
    expect(harness.onCacheSnapshot).toHaveBeenCalledWith(
      "data:image/png;base64,settled",
    );
  });

  it("ignores an initial capture that resolves after resize has settled", async () => {
    const firstCapture = deferred<string | null>();
    const harness = createHarness();
    harness.capture
      .mockReturnValueOnce(firstCapture.promise)
      .mockResolvedValueOnce("data:image/png;base64,settled");

    harness.controller.resize();
    harness.runOnlyTimer();
    firstCapture.resolve("data:image/png;base64,stale");
    await firstCapture.promise;
    await Promise.resolve();

    expect(harness.onSnapshot).not.toHaveBeenCalledWith(
      "data:image/png;base64,stale",
    );
  });

  it("cancels timers and ignores captures after disposal", async () => {
    const firstCapture = deferred<string | null>();
    const harness = createHarness();
    harness.capture.mockReturnValue(firstCapture.promise);

    harness.controller.resize();
    harness.controller.dispose();
    firstCapture.resolve("data:image/png;base64,late");
    await firstCapture.promise;
    await Promise.resolve();

    expect(harness.timers.size).toBe(0);
    expect(harness.onSnapshot).not.toHaveBeenCalled();
    expect(harness.onCacheSnapshot).not.toHaveBeenCalled();
  });
});
