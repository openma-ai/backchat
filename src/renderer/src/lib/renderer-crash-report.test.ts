import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  formatRendererCrashDetails,
  installRendererCrashHandlers,
  reportRendererCrash,
} from "./renderer-crash-report";

describe("renderer crash report helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      backchat: {
        rendererCrashLog: vi.fn().mockResolvedValue(undefined),
      },
      addEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("formats copy payloads with stack and component stack", () => {
    const text = formatRendererCrashDetails({
      message: "Boom",
      stack: "Error: Boom",
      componentStack: "\n    in Root",
    });
    expect(text).toContain("Boom");
    expect(text).toContain("Error: Boom");
    expect(text).toContain("Component stack:");
    expect(text).toContain("in Root");
  });

  it("forwards reports through backchat IPC", () => {
    reportRendererCrash({
      source: "window.onerror",
      message: "fail",
    });
    expect(window.backchat.rendererCrashLog).toHaveBeenCalledWith({
      source: "window.onerror",
      message: "fail",
    });
  });

  it("registers window error listeners on first install", () => {
    installRendererCrashHandlers();
    expect(window.addEventListener).toHaveBeenCalledWith(
      "error",
      expect.any(Function),
    );
    expect(window.addEventListener).toHaveBeenCalledWith(
      "unhandledrejection",
      expect.any(Function),
    );
  });
});
