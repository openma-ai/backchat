import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configureAppLog, flushAppLog } from "./app-log.js";
import {
  forgetRendererCrashContext,
  logChildProcessGone,
  logRendererConsoleError,
  logRendererCrash,
  newCrashErrorId,
  noteRendererCrashContext,
} from "./renderer-crash-log.js";

let root: string;

function readLog(): Array<Record<string, unknown>> {
  return readFileSync(join(root, "logs", "backchat.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "backchat-crash-log-"));
  configureAppLog(root);
  await flushAppLog();
});

afterEach(async () => {
  await flushAppLog();
  configureAppLog(null);
  rmSync(root, { recursive: true, force: true });
});

describe("logRendererCrash", () => {
  it("writes the report as a structured app.renderer_crash entry", async () => {
    logRendererCrash(
      {
        source: "window.onerror",
        errorId: "deadbeef",
        message: "boom",
        stack: "Error: boom\n    at render (app.tsx:1)",
        componentStack: "    at ChatView\n    at App",
        route: "/chat/sess-1",
        session: { id: "sess-1", agentId: "claude-acp" },
      },
      42,
    );
    await flushAppLog();

    expect(readLog()).toEqual([
      expect.objectContaining({
        event: "app.renderer_crash",
        errorId: "deadbeef",
        source: "window.onerror",
        message: "boom",
        stack: expect.stringContaining("at render"),
        component_stack: expect.stringContaining("at ChatView"),
        route: "/chat/sess-1",
        session_id: "sess-1",
        agent_id: "claude-acp",
      }),
    ]);
  });

  it("generates a short errorId when the report has none", async () => {
    logRendererCrash({ source: "render-process-gone", message: "gone" });
    await flushAppLog();

    const [entry] = readLog();
    expect(entry.errorId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("reuses newCrashErrorId format for consistency with the crash page", () => {
    expect(newCrashErrorId()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("records process-level details for render-process-gone and did-fail-load", async () => {
    logRendererCrash({
      source: "render-process-gone",
      message: "Renderer process exited (killed)",
      reason: "killed",
      exitCode: 133,
    });
    logRendererCrash({
      source: "did-fail-load",
      message: "Load failed: ERR_CONNECTION_REFUSED",
      exitCode: -102,
      url: "backchat://app/index.html",
    });
    await flushAppLog();

    const [gone, failedLoad] = readLog();
    expect(gone).toEqual(
      expect.objectContaining({
        source: "render-process-gone",
        reason: "killed",
        exit_code: 133,
      }),
    );
    expect(failedLoad).toEqual(
      expect.objectContaining({
        source: "did-fail-load",
        exit_code: -102,
        url: "backchat://app/index.html",
      }),
    );
  });

  it("redacts secrets from every free-text field", async () => {
    logRendererCrash({
      source: "window.onerror",
      message: "request failed: Bearer sk-live-secret-key-12345",
      stack: "Error at fetch (api_key=abc123)",
      url: "https://example.com/?access_token=tok-secret",
    });
    await flushAppLog();

    const [entry] = readLog();
    expect(entry.message).toBe("request failed: Bearer [redacted]");
    expect(entry.stack).not.toContain("abc123");
    expect(entry.url).not.toContain("tok-secret");
    expect(entry.url).toContain("[redacted]");
  });

  it("merges the cached route/session context when the report omits it", async () => {
    noteRendererCrashContext(7, {
      route: "/chat/sess-9",
      sessionId: "sess-9",
      agentId: "codex-acp",
    });
    // A render-process-gone arrives after the renderer died: it carries no
    // route/session of its own, so it borrows the cached context.
    logRendererCrash(
      { source: "render-process-gone", message: "Renderer process exited (crashed)", reason: "crashed" },
      7,
    );
    await flushAppLog();

    const [entry] = readLog();
    expect(entry).toEqual(
      expect.objectContaining({
        route: "/chat/sess-9",
        session_id: "sess-9",
        agent_id: "codex-acp",
      }),
    );
  });

  it("prefers report-provided context over the cached one", async () => {
    noteRendererCrashContext(7, { route: "/settings" });
    logRendererCrash(
      {
        source: "unhandledrejection",
        message: "nope",
        route: "/chat/sess-1",
        session: { id: "sess-1" },
      },
      7,
    );
    await flushAppLog();

    const [entry] = readLog();
    expect(entry.route).toBe("/chat/sess-1");
    expect(entry.session_id).toBe("sess-1");
    expect(entry.agent_id).toBeUndefined();
  });

  it("drops the cached context once the webContents is gone", async () => {
    noteRendererCrashContext(9, { route: "/chat/sess-9" });
    forgetRendererCrashContext(9);
    logRendererCrash({ source: "render-process-gone", message: "gone" }, 9);
    await flushAppLog();

    const [entry] = readLog();
    expect(entry.route).toBeUndefined();
  });

  it("survives a malformed IPC payload without throwing", async () => {
    expect(() =>
      logRendererCrash(null as unknown as Parameters<typeof logRendererCrash>[0]),
    ).not.toThrow();
    expect(() =>
      logRendererCrash("oops" as unknown as Parameters<typeof logRendererCrash>[0]),
    ).not.toThrow();
    await flushAppLog();

    const entries = readLog();
    expect(entries[0]).toEqual(
      expect.objectContaining({ source: "unknown", errorId: expect.any(String) }),
    );
  });
});

describe("logRendererConsoleError", () => {
  it("writes error-level console output as app.renderer_console_error", async () => {
    noteRendererCrashContext(3, { route: "/chat/sess-3" });
    logRendererConsoleError(
      {
        message: "Uncaught TypeError: token=sekret is not a function",
        sourceId: "backchat://app/assets/index.js",
        lineNumber: 120,
      },
      3,
    );
    await flushAppLog();

    const [entry] = readLog();
    expect(entry).toEqual(
      expect.objectContaining({
        event: "app.renderer_console_error",
        errorId: expect.stringMatching(/^[0-9a-f]{8}$/),
        source_id: "backchat://app/assets/index.js",
        line: 120,
        route: "/chat/sess-3",
      }),
    );
    expect(entry.message).toBe("Uncaught TypeError: token=[redacted] is not a function");
  });

  it("omits optional fields that are absent", async () => {
    logRendererConsoleError({ message: "plain error" });
    await flushAppLog();

    const [entry] = readLog();
    expect(entry).toEqual(
      expect.objectContaining({ message: "plain error" }),
    );
    expect(entry.source_id).toBeUndefined();
    expect(entry.line).toBeUndefined();
  });
});

describe("logChildProcessGone", () => {
  it("writes non-renderer exits as app.child_process_gone", async () => {
    logChildProcessGone({
      type: "GPU",
      name: "GPU process",
      reason: "crashed",
      exitCode: 1,
    });
    await flushAppLog();

    const [entry] = readLog();
    expect(entry).toEqual(
      expect.objectContaining({
        event: "app.child_process_gone",
        errorId: expect.stringMatching(/^[0-9a-f]{8}$/),
        process_type: "GPU",
        name: "GPU process",
        reason: "crashed",
        exit_code: 1,
      }),
    );
  });

  it("falls back to an unknown process type", async () => {
    logChildProcessGone({ reason: "killed" });
    await flushAppLog();

    const [entry] = readLog();
    expect(entry.process_type).toBe("unknown");
  });

  it("writes a minimal entry when only the type is known", async () => {
    logChildProcessGone({ type: "Utility" });
    await flushAppLog();

    const [entry] = readLog();
    expect(entry?.process_type).toBe("Utility");
    expect(entry?.reason).toBeUndefined();
    expect(entry?.exit_code).toBeUndefined();
  });
});
