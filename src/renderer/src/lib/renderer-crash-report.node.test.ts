/**
 * Node-environment coverage: main.tsx is imported by entry tests without a
 * DOM, so the crash handlers must no-op cleanly when `window` is absent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installRendererCrashHandlers,
  reportRendererCrash,
  resetRendererCrashHandlersForTest,
} from "./renderer-crash-report";

afterEach(() => {
  resetRendererCrashHandlersForTest();
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe("renderer crash reporting without a DOM", () => {
  it("installs as a no-op when window is absent", () => {
    expect(() => installRendererCrashHandlers()).not.toThrow();
    expect(() => installRendererCrashHandlers()).not.toThrow();
  });

  it("installs as a no-op when window lacks addEventListener", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => installRendererCrashHandlers()).not.toThrow();
  });

  it("reports via console.error when the bridge is absent", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const errorId = reportRendererCrash({
      source: "window.onerror",
      message: "node-side report",
    });

    expect(errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(consoleError).toHaveBeenCalledWith(
      "[renderer-crash]",
      expect.objectContaining({ errorId, message: "node-side report" }),
    );
  });
});
