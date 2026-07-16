import { describe, expect, it, vi } from "vitest";

import { BrowserViewRegistry, type BrowserViewTarget } from "./browser-view-registry";
import {
  BrowserWebviewTools,
  type BrowserUiCommand,
} from "./browser-webview-tools";

function mutableTarget(id: number, initialUrl: string): BrowserViewTarget & {
  loadURL: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
} {
  let url = initialUrl;
  return {
    id,
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => `Title ${id}`,
    loadURL: vi.fn(async (next: string) => {
      url = next;
    }),
    executeJavaScript: vi.fn(async () => undefined),
    capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from("visible-png") })),
  };
}

describe("BrowserWebviewTools", () => {
  it("lists, creates, selects, and closes real in-app browser tabs", async () => {
    const registry = new BrowserViewRegistry();
    const first = mutableTarget(11, "https://one.example");
    registry.register({
      sessionId: "session-1",
      tabId: "tab-one",
      hostWebContentsId: 7,
      target: first,
      active: true,
    });

    const targets = new Map<string, BrowserViewTarget>();
    const commands: BrowserUiCommand[] = [];
    const tools = new BrowserWebviewTools(registry, {
      createTabId: () => "tab-two",
      requestUi: (command) => {
        commands.push(command);
        if (command.action === "open") {
          const second = mutableTarget(12, command.url);
          targets.set(command.tabId, second);
          registry.register({
            sessionId: command.sessionId,
            tabId: command.tabId,
            hostWebContentsId: 7,
            target: second,
            active: true,
          });
        } else if (command.action === "activate") {
          registry.setActive(command.sessionId, command.tabId, 7);
        } else {
          const entry = registry.tab(command.sessionId, command.tabId);
          if (entry) {
            registry.unregister(
              command.sessionId,
              command.tabId,
              entry.target.id,
              entry.hostWebContentsId,
            );
          }
        }
      },
    });

    expect(await tools.tabs("session-1", { action: "list" })).toMatchObject({
      tabs: [{ tab_id: "tab-one", active: true, url: "https://one.example" }],
    });

    const opened = await tools.tabs("session-1", {
      action: "new",
      url: "https://two.example",
    });
    expect(opened).toMatchObject({
      active_tab_id: "tab-two",
      tabs: [
        { tab_id: "tab-one", active: false },
        { tab_id: "tab-two", active: true, url: "https://two.example" },
      ],
    });

    await tools.tabs("session-1", { action: "select", tab_id: "tab-one" });
    expect(registry.active("session-1")?.tabId).toBe("tab-one");

    await tools.tabs("session-1", { action: "close", tab_id: "tab-two" });
    expect(registry.tab("session-1", "tab-two")).toBeNull();
    expect(commands.map((command) => command.action)).toEqual([
      "open",
      "activate",
      "close",
    ]);
  });

  it("navigates the visible active tab instead of launching another browser", async () => {
    const registry = new BrowserViewRegistry();
    const current = mutableTarget(21, "https://before.example");
    registry.register({
      sessionId: "session-1",
      tabId: "tab-current",
      hostWebContentsId: 7,
      target: current,
      active: true,
    });
    const requestUi = vi.fn();
    const tools = new BrowserWebviewTools(registry, { requestUi });

    const result = await tools.navigate("session-1", "https://after.example/path");

    expect(current.loadURL).toHaveBeenCalledWith("https://after.example/path");
    expect(requestUi).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      tab_id: "tab-current",
      url: "https://after.example/path",
    });
  });

  it("accepts an aborted navigation only after the WebView reached the target URL", async () => {
    const registry = new BrowserViewRegistry();
    const reached = mutableTarget(22, "https://before.example");
    reached.loadURL.mockImplementationOnce(async (next: string) => {
      Object.defineProperty(reached, "getURL", { value: () => next });
      throw new Error("ERR_ABORTED (-3) loading 'about:blank'");
    });
    registry.register({
      sessionId: "session-1",
      tabId: "tab-current",
      hostWebContentsId: 7,
      target: reached,
      active: true,
    });
    const tools = new BrowserWebviewTools(registry, { requestUi: vi.fn() });

    await expect(tools.navigate("session-1", "about:blank")).resolves.toMatchObject({
      url: "about:blank",
    });

    const unchanged = mutableTarget(23, "https://before.example");
    unchanged.loadURL.mockRejectedValueOnce(new Error("ERR_ABORTED (-3) loading 'about:blank'"));
    registry.register({
      sessionId: "session-2",
      tabId: "tab-current",
      hostWebContentsId: 7,
      target: unchanged,
      active: true,
    });

    await expect(tools.navigate("session-2", "about:blank")).rejects.toThrow("ERR_ABORTED");
  });

  it("opens a visible tab when navigation starts without one", async () => {
    const registry = new BrowserViewRegistry();
    const requestUi = vi.fn((command: BrowserUiCommand) => {
      if (command.action !== "open") return;
      registry.register({
        sessionId: command.sessionId,
        tabId: command.tabId,
        hostWebContentsId: 7,
        target: mutableTarget(31, command.url),
        active: true,
      });
    });
    const tools = new BrowserWebviewTools(registry, {
      requestUi,
      createTabId: () => "tab-created",
    });

    const result = await tools.navigate("session-1", "https://created.example");

    expect(requestUi).toHaveBeenCalledWith({
      action: "open",
      sessionId: "session-1",
      tabId: "tab-created",
      url: "https://created.example",
    });
    expect(result).toMatchObject({
      tab_id: "tab-created",
      url: "https://created.example",
    });
  });

  it("reuses a visible tab whose renderer registration is still in flight", async () => {
    const registry = new BrowserViewRegistry();
    const pending = mutableTarget(32, "https://www.google.com");
    const requestUi = vi.fn();
    const tools = new BrowserWebviewTools(registry, {
      requestUi,
      uiTimeoutMs: 100,
    });
    setTimeout(() => {
      registry.register({
        sessionId: "session-1",
        tabId: "tab-mounting",
        hostWebContentsId: 7,
        target: pending,
        active: true,
      });
    }, 5);

    const result = await tools.navigate("session-1", "about:blank");

    expect(requestUi).not.toHaveBeenCalled();
    expect(pending.loadURL).toHaveBeenCalledWith("about:blank");
    expect(result).toMatchObject({ tab_id: "tab-mounting", url: "about:blank" });
  });

  it("runs page actions and returns screenshots from the active WebView", async () => {
    const registry = new BrowserViewRegistry();
    const current = mutableTarget(41, "https://page.example");
    current.executeJavaScript
      .mockResolvedValueOnce({ selector: "#save", text: "Save" })
      .mockResolvedValueOnce({ selector: "#name", textLength: 5 })
      .mockResolvedValueOnce("Visible page text")
      .mockResolvedValueOnce({ ok: true });
    registry.register({
      sessionId: "session-1",
      tabId: "tab-current",
      hostWebContentsId: 7,
      target: current,
      active: true,
    });
    const tools = new BrowserWebviewTools(registry, { requestUi: vi.fn() });

    await expect(tools.click("session-1", "#save")).resolves.toContain("#save");
    await expect(tools.type("session-1", "#name", "Alice", true)).resolves.toContain(
      "5 chars",
    );
    await expect(tools.getText("session-1")).resolves.toBe("Visible page text");
    await expect(tools.evaluate("session-1", "({ ok: true })")).resolves.toEqual({ ok: true });
    await expect(tools.screenshot("session-1")).resolves.toMatchObject({
      media_type: "image/png",
      data: Buffer.from("visible-png").toString("base64"),
      tab_id: "tab-current",
    });
  });

  it("captures the full document through the same WebView debugger", async () => {
    const registry = new BrowserViewRegistry();
    const debuggerApi = {
      isAttached: vi.fn<() => boolean>(() => false),
      attach: vi.fn<(protocolVersion?: string) => void>(),
      detach: vi.fn<() => void>(),
      sendCommand: vi.fn<(
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<unknown>>(async (method) => {
        if (method === "Page.getLayoutMetrics") {
          return { cssContentSize: { x: 0, y: 0, width: 900, height: 2400 } };
        }
        if (method === "Page.captureScreenshot") {
          return { data: Buffer.from("full-page-png").toString("base64") };
        }
        return {};
      }),
    };
    const current: BrowserViewTarget = {
      ...mutableTarget(51, "https://long.example"),
      debugger: debuggerApi,
    };
    registry.register({
      sessionId: "session-1",
      tabId: "tab-long",
      hostWebContentsId: 7,
      target: current,
      active: true,
    });
    const tools = new BrowserWebviewTools(registry, { requestUi: vi.fn() });

    await expect(tools.screenshot("session-1", true)).resolves.toMatchObject({
      data: Buffer.from("full-page-png").toString("base64"),
    });
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.objectContaining({
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 900, height: 2400, scale: 1 },
      }),
    );
    expect(debuggerApi.detach).toHaveBeenCalledOnce();
  });
});
