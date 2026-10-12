/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatRendererCrashDetails,
  installRendererCrashHandlers,
  newCrashErrorId,
  reportRendererCrash,
  resetRendererCrashHandlersForTest,
} from "./renderer-crash-report";

const rendererCrashLog = vi.fn().mockResolvedValue(undefined);

function stubBridge(): void {
  (window as unknown as Record<string, unknown>).backchat = {
    rendererCrashLog,
  };
}

function restoreBridge(): void {
  delete (window as unknown as Record<string, unknown>).backchat;
}

beforeEach(() => {
  resetRendererCrashHandlersForTest();
  rendererCrashLog.mockClear();
  stubBridge();
});

afterEach(() => {
  resetRendererCrashHandlersForTest();
  restoreBridge();
});

describe("newCrashErrorId", () => {
  it("returns a short id suitable for the crash page", () => {
    expect(newCrashErrorId()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("reportRendererCrash", () => {
  it("sends the report over the preload bridge and returns the errorId", () => {
    const errorId = reportRendererCrash({
      source: "window.onerror",
      message: "boom",
    });

    expect(errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(rendererCrashLog).toHaveBeenCalledWith(
      expect.objectContaining({
        errorId,
        source: "window.onerror",
        message: "boom",
      }),
    );
  });

  it("merges crash context under explicit report fields", () => {
    installRendererCrashHandlers({
      context: () => ({
        route: "/chat/sess-1",
        session: { id: "sess-1", agentId: "claude-acp" },
      }),
    });

    reportRendererCrash({ source: "unhandledrejection", message: "nope" });
    reportRendererCrash({
      source: "window.onerror",
      message: "explicit",
      route: "/settings",
    });

    expect(rendererCrashLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ route: "/chat/sess-1", session: { id: "sess-1", agentId: "claude-acp" } }),
    );
    expect(rendererCrashLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ route: "/settings" }),
    );
  });

  it("dedupes reports of the same error object", () => {
    const error = new Error("once");
    const first = reportRendererCrash(
      { source: "error-boundary", message: "once" },
      error,
    );
    const second = reportRendererCrash(
      { source: "window.onerror", message: "once" },
      error,
    );

    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(second).toBeUndefined();
    expect(rendererCrashLog).toHaveBeenCalledTimes(1);
  });

  it("falls back to console.error when the bridge is unavailable", () => {
    restoreBridge();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const errorId = reportRendererCrash({
      source: "window.onerror",
      message: "no bridge",
    });

    expect(errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(consoleError).toHaveBeenCalledWith(
      "[renderer-crash]",
      expect.objectContaining({ errorId, message: "no bridge" }),
    );
    consoleError.mockRestore();
  });

  it("logs a send failure instead of crashing on IPC errors", async () => {
    rendererCrashLog.mockRejectedValueOnce(new Error("ipc down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const errorId = reportRendererCrash({
      source: "window.onerror",
      message: "send fails",
    });
    await Promise.resolve();

    expect(errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(consoleError).toHaveBeenCalledWith(
      "[renderer-crash] IPC failed",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});

describe("installRendererCrashHandlers", () => {
  it("is idempotent", () => {
    installRendererCrashHandlers();
    installRendererCrashHandlers();
    const error = new Error("boom");
    window.dispatchEvent(
      Object.assign(new Event("error"), { message: "boom", error }),
    );
    expect(rendererCrashLog).toHaveBeenCalledTimes(1);
  });

  it("reports uncaught errors and fires the fatal-crash callback", () => {
    const onFatalCrash = vi.fn();
    installRendererCrashHandlers({ onFatalCrash });
    const error = new Error("boom");

    window.dispatchEvent(
      Object.assign(new Event("error"), {
        message: "Uncaught Error: boom",
        error,
      }),
    );

    expect(rendererCrashLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "window.onerror",
        message: "Uncaught Error: boom",
        stack: expect.stringContaining("boom"),
      }),
    );
    expect(onFatalCrash).toHaveBeenCalledWith(
      expect.objectContaining({ errorId: rendererCrashLog.mock.calls[0][0].errorId }),
    );
  });

  it("logs unhandled rejections without showing the crash page", () => {
    const onFatalCrash = vi.fn();
    installRendererCrashHandlers({ onFatalCrash });

    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), {
        reason: new Error("async boom"),
      }),
    );

    expect(rendererCrashLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "unhandledrejection",
        message: "async boom",
      }),
    );
    expect(onFatalCrash).not.toHaveBeenCalled();
  });

  it("stringifies non-Error rejection reasons", () => {
    installRendererCrashHandlers();

    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: "denied" }),
    );

    expect(rendererCrashLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "unhandledrejection",
        message: "denied",
        stack: undefined,
      }),
    );
  });

  it("ignores resource-load error events and ResizeObserver noise", () => {
    const onFatalCrash = vi.fn();
    installRendererCrashHandlers({ onFatalCrash });

    // Element resource failures carry neither .error nor .message.
    window.dispatchEvent(new Event("error"));
    window.dispatchEvent(
      Object.assign(new Event("error"), {
        message: "ResizeObserver loop limit exceeded",
      }),
    );

    expect(rendererCrashLog).not.toHaveBeenCalled();
    expect(onFatalCrash).not.toHaveBeenCalled();
  });

  it("falls back to String(error) when the error event has no message", () => {
    installRendererCrashHandlers();

    window.dispatchEvent(
      Object.assign(new Event("error"), { error: new Error("no message") }),
    );
    window.dispatchEvent(
      Object.assign(new Event("error"), { message: "", error: null }),
    );

    expect(rendererCrashLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: "Error: no message" }),
    );
    expect(rendererCrashLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: "Unknown error" }),
    );
  });

  it("does not double-report an error already sent by the boundary", () => {
    const onFatalCrash = vi.fn();
    installRendererCrashHandlers({ onFatalCrash });
    const error = new Error("boundary first");

    // React dev mode replays boundary-caught errors through window.onerror.
    reportRendererCrash(
      { source: "error-boundary", message: "boundary first" },
      error,
    );
    window.dispatchEvent(
      Object.assign(new Event("error"), { message: "boundary first", error }),
    );

    expect(rendererCrashLog).toHaveBeenCalledTimes(1);
    expect(onFatalCrash).not.toHaveBeenCalled();
  });
});

describe("formatRendererCrashDetails", () => {
  it("leads with the error id so pasted reports can be matched to the log", () => {
    const text = formatRendererCrashDetails({
      errorId: "abc12345",
      message: "boom",
      stack: "Error: boom",
      componentStack: "at App",
    });

    expect(text).toMatch(/^Error ID: abc12345\nboom\n\nError: boom\n\nComponent stack:\nat App$/);
  });

  it("omits the error-id line when there is none", () => {
    expect(formatRendererCrashDetails({ message: "boom" })).toBe("boom");
  });
});
