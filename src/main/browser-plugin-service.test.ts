import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserUsePolicyError,
  createBrowserPluginService,
  defaultBrowserUrlPolicy,
  sniffBrowserScreenshotMime,
  type BrowserBackendAdapter,
  type BrowserDescriptor,
  type BrowserPluginStateEvent,
  type BrowserLocatorDescriptor,
  type BrowserTabInfo,
} from "./browser-plugin-service.js";

describe("BrowserPluginService", () => {
  it("lists in-app and Chrome extension browsers with distinct capabilities", async () => {
    const iab = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
      browserCapabilities: ["visibility", "viewport"],
      tabCapabilities: ["pageAssets"],
    });
    const chrome = fakeAdapter({
      id: "chrome-1",
      type: "extension",
      name: "Chrome",
      browserCapabilities: [],
      tabCapabilities: ["pageAssets"],
    });
    const service = createBrowserPluginService({ adapters: [iab, chrome] });

    await expect(service.listBrowsers()).resolves.toEqual([
      iab.descriptor,
      chrome.descriptor,
    ]);
    await expect(service.getBrowser("iab")).resolves.toEqual(iab.descriptor);
    await expect(service.getBrowser("chrome-1")).resolves.toEqual(chrome.descriptor);
  });

  it("rejects unknown browser refs with a stable error", async () => {
    const service = createBrowserPluginService({ adapters: [] });

    await expect(service.getBrowser("missing")).rejects.toThrow(
      "Browser is not available: missing",
    );
  });

  it("enforces the observed Browser URL policy before adapter navigation", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("iab");

    await expect(
      service.goto({ browser: "iab", tabId: tab.id, url: "http://127.0.0.1:5173/" }),
    ).resolves.toMatchObject({
      id: tab.id,
      url: "http://127.0.0.1:5173/",
    });
    await expect(
      service.goto({ browser: "iab", tabId: tab.id, url: "https://example.com/" }),
    ).resolves.toMatchObject({
      id: tab.id,
      url: "https://example.com/",
    });
    await expect(
      service.goto({ browser: "iab", tabId: tab.id, url: "about:blank" }),
    ).resolves.toMatchObject({
      id: tab.id,
      url: "about:blank",
    });
    await expect(
      service.goto({ browser: "iab", tabId: tab.id, url: "data:text/html,blocked" }),
    ).rejects.toBeInstanceOf(BrowserUsePolicyError);
    await expect(
      service.goto({
        browser: "iab",
        tabId: tab.id,
        url: "file:///Users/xiaoyang/Proj/backchat/package.json",
      }),
    ).rejects.toMatchObject({ code: "BROWSER_URL_BLOCKED" });
    expect(adapter.navigate).toHaveBeenCalledTimes(3);
  });

  it("tracks tab lifecycle through the selected adapter", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const service = createBrowserPluginService({ adapters: [adapter] });

    const tab = await service.newTab("iab");
    await service.goto({ browser: "iab", tabId: tab.id, url: "about:blank" });
    await expect(service.listTabs("iab")).resolves.toEqual([
      { id: tab.id, title: "about:blank", url: "about:blank" },
    ]);

    await service.closeTab({ browser: "iab", tabId: tab.id });
    await expect(service.listTabs("iab")).resolves.toEqual([]);
  });

  it("tracks the selected automation tab and separates user-open tabs", async () => {
    const iab = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
      userTabs: [],
    });
    const chrome = fakeAdapter({
      id: "chrome-1",
      type: "extension",
      name: "Chrome",
      userTabs: [
        { id: "101", title: "Docs", url: "https://example.com/docs" },
      ],
    });
    const service = createBrowserPluginService({ adapters: [iab, chrome] });
    const selectedApi = service as unknown as {
      getTab(params: { browser: string; tabId: string }): Promise<BrowserTabInfo>;
      selectedTab(browser: string): Promise<BrowserTabInfo | null>;
      selectTab(params: { browser: string; tabId: string }): Promise<BrowserTabInfo>;
      userOpenTabs(browser: string): Promise<BrowserTabInfo[]>;
    };

    await expect(selectedApi.selectedTab("iab")).resolves.toBeNull();
    await expect(selectedApi.userOpenTabs("iab")).resolves.toEqual([]);
    await expect(selectedApi.userOpenTabs("chrome")).resolves.toEqual([
      { id: "101", title: "Docs", url: "https://example.com/docs" },
    ]);

    const first = await service.newTab("iab");
    const second = await service.newTab("iab");
    await expect(selectedApi.selectedTab("iab")).resolves.toEqual(second);
    await expect(selectedApi.selectTab({ browser: "iab", tabId: first.id }))
      .resolves.toEqual(first);
    await expect(selectedApi.selectedTab("iab")).resolves.toEqual(first);
    await expect(selectedApi.getTab({ browser: "iab", tabId: second.id }))
      .resolves.toEqual(second);
    await expect(selectedApi.selectedTab("iab")).resolves.toEqual(first);

    await service.goto({
      browser: "iab",
      tabId: first.id,
      url: "https://example.com/first",
    });
    await expect(selectedApi.selectedTab("iab")).resolves.toMatchObject({
      id: first.id,
      url: "https://example.com/first",
    });

    await service.closeTab({ browser: "iab", tabId: first.id });
    await expect(selectedApi.selectedTab("iab")).resolves.toBeNull();
  });

  it("reports missing tab lookups with the currently open tab ids", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const first = await service.newTab("iab");
    const second = await service.newTab("iab");

    await expect(service.getTab({
      browser: "iab",
      tabId: "missing",
    })).rejects.toThrow(
      `tabs.get could not find tab id "missing"; open tabs: ${first.id}, ${second.id}`,
    );
  });

  it("names the browser automation session and emits the name in state", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const events: BrowserPluginStateEvent[] = [];
    service.onEvent((event) => events.push(event));

    await expect(service.nameSession({
      browser: "iab",
      name: "Fixture checkout",
    })).resolves.toEqual({
      browser: "iab-1",
      name: "Fixture checkout",
    });

    await expect(service.getSessionName("iab")).resolves.toBe("Fixture checkout");
    await expect(service.getBrowser("iab")).resolves.toMatchObject({
      metadata: { sessionName: "Fixture checkout" },
    });
    expect(events.at(-1)).toMatchObject({
      browser: {
        id: "iab-1",
        metadata: { sessionName: "Fixture checkout" },
      },
    });
  });

  it("exposes current title/url and history controls through the selected adapter", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("iab");
    await service.goto({ browser: "iab", tabId: tab.id, url: "https://example.com/one" });
    await service.goto({ browser: "iab", tabId: tab.id, url: "https://example.com/two" });

    await expect(service.title({ browser: "iab", tabId: tab.id })).resolves.toBe("https://example.com/two");
    await expect(service.url({ browser: "iab", tabId: tab.id })).resolves.toBe("https://example.com/two");
    await expect(service.back({ browser: "iab", tabId: tab.id })).resolves.toMatchObject({
      url: "https://example.com/one",
    });
    await expect(service.forward({ browser: "iab", tabId: tab.id })).resolves.toMatchObject({
      url: "https://example.com/two",
    });
    await expect(service.reload({ browser: "iab", tabId: tab.id })).resolves.toMatchObject({
      url: "https://example.com/two",
    });
  });

  it("waits for a tab to reach a target URL or times out", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("iab");
    const waitApi = service as unknown as {
      waitForURL(params: {
        browser: string;
        tabId: string;
        url: string;
        timeoutMs?: number;
        pollMs?: number;
      }): Promise<BrowserTabInfo>;
    };

    const wait = waitApi.waitForURL({
      browser: "iab",
      tabId: tab.id,
      url: "https://example.com/ready",
      timeoutMs: 500,
      pollMs: 5,
    });
    await service.goto({
      browser: "iab",
      tabId: tab.id,
      url: "https://example.com/ready",
    });
    await expect(wait).resolves.toMatchObject({
      id: tab.id,
      url: "https://example.com/ready",
    });

    await expect(waitApi.waitForURL({
      browser: "iab",
      tabId: tab.id,
      url: "https://example.com/missing",
      timeoutMs: 1,
      pollMs: 1,
    })).rejects.toThrow("Timed out waiting for tab");
  });

  it("waits for the requested load state after URL convergence", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const readyStates = ["loading", "interactive"];
    adapter.evaluate = vi.fn(async () => readyStates.shift() ?? "complete");
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("iab");
    await service.goto({
      browser: "iab",
      tabId: tab.id,
      url: "https://example.com/ready",
    });
    const waitApi = service as unknown as {
      waitForURL(params: {
        browser: string;
        tabId: string;
        url: string;
        waitUntil?: "domcontentloaded" | "load" | "networkidle";
        timeoutMs?: number;
        pollMs?: number;
      }): Promise<BrowserTabInfo>;
    };

    await expect(waitApi.waitForURL({
      browser: "iab",
      tabId: tab.id,
      url: "https://example.com/ready",
      waitUntil: "domcontentloaded",
      timeoutMs: 500,
      pollMs: 1,
    })).resolves.toMatchObject({
      id: tab.id,
      url: "https://example.com/ready",
    });
    expect(adapter.evaluate).toHaveBeenCalledWith(tab.id, "document.readyState");
  });

  it("waits for a tab to reach a requested load state", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const readyStates = ["loading", "interactive"];
    adapter.evaluate = vi.fn(async () => readyStates.shift() ?? "complete");
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("iab");
    const waitApi = service as unknown as {
      waitForLoadState(params: {
        browser: string;
        tabId: string;
        state?: "domcontentloaded" | "load" | "networkidle";
        timeoutMs?: number;
        pollMs?: number;
      }): Promise<BrowserTabInfo>;
    };

    await expect(waitApi.waitForLoadState({
      browser: "iab",
      tabId: tab.id,
      state: "domcontentloaded",
      timeoutMs: 500,
      pollMs: 1,
    })).resolves.toEqual(tab);
    expect(adapter.evaluate).toHaveBeenCalledWith(tab.id, "document.readyState");
  });

  it("sniffs screenshot MIME type instead of assuming PNG", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
      screenshotBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("iab");

    await expect(
      service.screenshot({ browser: "iab", tabId: tab.id }),
    ).resolves.toEqual({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
      mimeType: "image/jpeg",
    });
    expect(sniffBrowserScreenshotMime(Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))).toBe("image/png");
  });

  it("exposes viewport and visibility only for capable adapters", async () => {
    const iab = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
      browserCapabilities: ["visibility", "viewport"],
    });
    const chrome = fakeAdapter({
      id: "chrome-1",
      type: "extension",
      name: "Chrome",
    });
    const service = createBrowserPluginService({ adapters: [iab, chrome] });

    await expect(service.setViewport("iab", { width: 390, height: 640 })).resolves.toBeUndefined();
    await expect(service.setVisibility("iab", false)).resolves.toBeUndefined();
    await expect(service.setViewport("chrome-1", { width: 390, height: 640 }))
      .rejects.toThrow("Browser chrome-1 does not support viewport");
    await expect(service.setVisibility("chrome-1", false))
      .rejects.toThrow("Browser chrome-1 does not support visibility");
  });

  it("attaches and detaches visible IAB tab surfaces through capable adapters", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
      browserCapabilities: ["visibility", "viewAttach"],
    });
    const hostWindow = { id: "host-window" };
    const bounds = { x: 12, y: 42, width: 360, height: 540 };
    const attachView = vi.fn(async () => undefined);
    const detachView = vi.fn(async () => undefined);
    adapter.attachView = attachView;
    adapter.detachView = detachView;
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("iab");

    await expect((service as unknown as {
      attachView(params: {
        browser: string;
        tabId: string;
        hostWindow: unknown;
        bounds: typeof bounds;
        visible: boolean;
      }): Promise<void>;
      detachView(params: { browser: string; tabId: string }): Promise<void>;
    }).attachView({
      browser: "iab",
      tabId: tab.id,
      hostWindow,
      bounds,
      visible: true,
    })).resolves.toBeUndefined();
    expect(attachView).toHaveBeenCalledWith(tab.id, { hostWindow, bounds, visible: true });

    await expect((service as unknown as {
      detachView(params: { browser: string; tabId: string }): Promise<void>;
    }).detachView({ browser: "iab", tabId: tab.id })).resolves.toBeUndefined();
    expect(detachView).toHaveBeenCalledWith(tab.id);
  });

  it("emits browser state snapshots for visible IAB tab changes", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
      browserCapabilities: ["visibility"],
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const events: BrowserPluginStateEvent[] = [];
    const unsubscribe = service.onEvent((event) => events.push(event));

    const tab = await service.newTab("iab");
    await service.setVisibility("iab", true);
    await service.goto({
      browser: "iab",
      tabId: tab.id,
      url: "http://127.0.0.1:5173/",
    });
    await service.closeTab({ browser: "iab", tabId: tab.id });
    unsubscribe();

    expect(events).toEqual([
      {
        type: "browser.state",
        browser: adapter.descriptor,
        visible: false,
        activeTabId: tab.id,
        tabs: [{ id: tab.id, title: "about:blank", url: "about:blank" }],
      },
      {
        type: "browser.state",
        browser: adapter.descriptor,
        visible: true,
        activeTabId: tab.id,
        tabs: [{ id: tab.id, title: "about:blank", url: "about:blank" }],
      },
      {
        type: "browser.state",
        browser: adapter.descriptor,
        visible: true,
        activeTabId: tab.id,
        tabs: [
          {
            id: tab.id,
            title: "http://127.0.0.1:5173/",
            url: "http://127.0.0.1:5173/",
          },
        ],
      },
      {
        type: "browser.state",
        browser: adapter.descriptor,
        visible: true,
        tabs: [],
      },
    ]);
  });

  it("filters noisy dev logs by page URL when requested", async () => {
    const adapter = fakeAdapter({
      id: "chrome-1",
      type: "extension",
      name: "Chrome",
      logs: [
        {
          level: "warn",
          message: "extension noise",
          timestamp: "2026-07-02T00:00:00.000Z",
          url: "chrome-extension://abc/content.js",
        },
        {
          level: "log",
          message: "clicked-log",
          timestamp: "2026-07-02T00:00:01.000Z",
          url: "http://127.0.0.1:5173/",
        },
      ],
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("chrome-1");

    await expect(
      service.devLogs({ browser: "chrome-1", tabId: tab.id, pageUrl: "http://127.0.0.1:5173/" }),
    ).resolves.toEqual([
      {
        level: "log",
        message: "clicked-log",
        timestamp: "2026-07-02T00:00:01.000Z",
        url: "http://127.0.0.1:5173/",
      },
    ]);
  });

  it("filters dev logs by URL, level, text, and latest-entry limit", async () => {
    const pageUrl = "http://127.0.0.1:5173/";
    const adapter = fakeAdapter({
      id: "chrome-1",
      type: "extension",
      name: "Chrome",
      logs: [
        {
          level: "warn",
          message: "extension noise",
          timestamp: "2026-07-02T00:00:00.000Z",
          url: "chrome-extension://abc/content.js",
        },
        {
          level: "debug",
          message: "fixture debug",
          timestamp: "2026-07-02T00:00:01.000Z",
          url: pageUrl,
        },
        {
          level: "log",
          message: "fixture ready",
          timestamp: "2026-07-02T00:00:02.000Z",
          url: pageUrl,
        },
        {
          level: "error",
          message: "fixture failed",
          timestamp: "2026-07-02T00:00:03.000Z",
          url: pageUrl,
        },
        {
          level: "log",
          message: "other page log",
          timestamp: "2026-07-02T00:00:04.000Z",
          url: pageUrl,
        },
      ],
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("chrome-1");
    const params = {
      browser: "chrome-1",
      tabId: tab.id,
      pageUrl,
      levels: ["log", "error"] as Array<"log" | "error">,
      filter: "fixture",
      limit: 1,
    };

    await expect(service.devLogs(params)).resolves.toEqual([
      {
        level: "error",
        message: "fixture failed",
        timestamp: "2026-07-02T00:00:03.000Z",
        url: pageUrl,
      },
    ]);
  });

  it("proxies DOM, input, and dialog operations through capable adapters", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("iab");

    await expect(service.domSnapshot({ browser: "iab", tabId: tab.id }))
      .resolves.toBe("Ping\nName");
    await expect(service.evaluate({ browser: "iab", tabId: tab.id, expression: "document.title" }))
      .resolves.toBe("Probe");
    await expect(service.click({ browser: "iab", tabId: tab.id, selector: "#ping" }))
      .resolves.toBeUndefined();
    await expect(service.type({ browser: "iab", tabId: tab.id, selector: "#name", text: "Ada" }))
      .resolves.toBeUndefined();
    await expect(service.press({ browser: "iab", tabId: tab.id, key: "Enter" }))
      .resolves.toBeUndefined();
    await expect(service.cuaClick({ browser: "iab", tabId: tab.id, x: 120, y: 80 }))
      .resolves.toBeUndefined();
    await expect(service.domCuaSnapshot({ browser: "iab", tabId: tab.id }))
      .resolves.toBe('<button node_id="1">Ping</button>');
    await expect(service.domCuaClick({ browser: "iab", tabId: tab.id, nodeId: "1" }))
      .resolves.toBeUndefined();

    adapter.activeDialog = { type: "confirm", message: "Proceed?" };
    await expect(service.getDialog({ browser: "iab", tabId: tab.id }))
      .resolves.toEqual({ type: "confirm", message: "Proceed?" });
    await expect(service.click({ browser: "iab", tabId: tab.id, selector: "#ping" }))
      .rejects.toThrow("Cannot click while a JavaScript dialog is active");
    await expect(service.acceptDialog({ browser: "iab", tabId: tab.id }))
      .resolves.toBeUndefined();
    expect(adapter.activeDialog).toBeNull();
  });

  it("proxies locator operations and blocks locator clicks while dialogs are active", async () => {
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("iab");
    const locator: BrowserLocatorDescriptor = {
      kind: "role",
      role: "button",
      name: "Submit",
      exact: true,
    };

    await expect(service.locatorCount({ browser: "iab", tabId: tab.id, locator }))
      .resolves.toBe(2);
    await expect(service.locatorInnerText({ browser: "iab", tabId: tab.id, locator }))
      .resolves.toBe("Submit");
    await expect(service.locatorAttribute({
      browser: "iab",
      tabId: tab.id,
      locator,
      name: "data-state",
    })).resolves.toBe("ready");
    await expect(service.locatorClick({ browser: "iab", tabId: tab.id, locator }))
      .resolves.toBeUndefined();
    await expect(service.locatorFill({
      browser: "iab",
      tabId: tab.id,
      locator: { kind: "label", value: "Name" },
      text: "Ada",
    })).resolves.toBeUndefined();
    await expect(service.locatorPress({
      browser: "iab",
      tabId: tab.id,
      locator: { kind: "text", value: "Submit" },
      key: "Enter",
    })).resolves.toBeUndefined();
    await expect(service.locatorSetChecked({
      browser: "iab",
      tabId: tab.id,
      locator: { kind: "label", value: "Subscribe" },
      checked: true,
    })).resolves.toBeUndefined();
    await expect(service.locatorSelectOption({
      browser: "iab",
      tabId: tab.id,
      locator: { kind: "label", value: "Mode" },
      value: "auto",
    })).resolves.toBeUndefined();

    adapter.activeDialog = { type: "confirm", message: "Proceed?" };
    await expect(service.locatorClick({ browser: "iab", tabId: tab.id, locator }))
      .rejects.toThrow("Cannot click while a JavaScript dialog is active");
    expect(adapter.locatorCalls).toEqual([
      ["count", tab.id, locator],
      ["innerText", tab.id, locator],
      ["attribute", tab.id, locator, "data-state"],
      ["click", tab.id, locator],
      ["fill", tab.id, { kind: "label", value: "Name" }, "Ada"],
      ["press", tab.id, { kind: "text", value: "Submit" }, "Enter"],
      ["setChecked", tab.id, { kind: "label", value: "Subscribe" }, true],
      ["selectOption", tab.id, { kind: "label", value: "Mode" }, "auto"],
    ]);
  });

  it("reports unsupported locator operations with the selected browser id", async () => {
    const adapter = fakeAdapter({
      id: "basic-browser",
      type: "cdp",
      name: "Basic Browser",
      locators: false,
    });
    const service = createBrowserPluginService({ adapters: [adapter] });
    const tab = await service.newTab("basic-browser");

    await expect(service.locatorCount({
      browser: "basic-browser",
      tabId: tab.id,
      locator: { kind: "text", value: "Submit" },
    })).rejects.toThrow("Browser basic-browser does not support locators");
  });

  it("returns page assets and clipboard text through Browser service tools", async () => {
    let clipboardText = "copied";
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
    });
    const service = createBrowserPluginService({
      adapters: [adapter],
      clipboard: {
        readText: async () => clipboardText,
        writeText: async (text) => {
          clipboardText = text;
        },
      },
    });
    const tab = await service.newTab("iab");

    await expect(service.pageAssets({ browser: "iab", tabId: tab.id }))
      .resolves.toEqual([
        { url: "http://127.0.0.1:5173/app.js", type: "script" },
        { url: "http://127.0.0.1:5173/logo.png", type: "image" },
      ]);
    await expect(service.clipboardReadText()).resolves.toBe("copied");
    await service.clipboardWriteText("next");
    await expect(service.clipboardReadText()).resolves.toBe("next");
  });

  it("bundles downloadable page assets and records skipped or failed assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-browser-assets-"));
    const adapter = fakeAdapter({
      id: "iab-1",
      type: "iab",
      name: "Backchat In-app Browser",
      pageAssets: [
        { url: "http://127.0.0.1:5173/app.js", type: "script" },
        { url: "data:image/png;base64,blocked", type: "image" },
        { url: "http://127.0.0.1:5173/missing.png", type: "image" },
      ],
    });
    const service = createBrowserPluginService({
      adapters: [adapter],
      assetBundleRoot: root,
      bundleId: () => "bundle-1",
      fetch: async (url) => {
        if (url === "http://127.0.0.1:5173/app.js") {
          return fakeFetchResponse({
            ok: true,
            status: 200,
            mimeType: "application/javascript",
            body: "console.log('ok');",
          });
        }
        return fakeFetchResponse({
          ok: false,
          status: 404,
          statusText: "Not Found",
          mimeType: "image/png",
          body: "missing",
        });
      },
    });
    const tab = await service.newTab("iab");

    const result = await service.bundleAssets({ browser: "iab", tabId: tab.id });

    expect(result.directory).toBe(join(root, "bundle-1"));
    expect(result.manifestPath).toBe(join(root, "bundle-1", "manifest.json"));
    expect(result.assets).toEqual([
      {
        url: "http://127.0.0.1:5173/app.js",
        type: "script",
        status: "saved",
        path: join(root, "bundle-1", "001-app.js"),
        mimeType: "application/javascript",
        byteSize: 18,
      },
      {
        url: "data:image/png;base64,blocked",
        type: "image",
        status: "skipped",
        reason: "unsupported protocol: data:",
      },
      {
        url: "http://127.0.0.1:5173/missing.png",
        type: "image",
        status: "failed",
        reason: "HTTP 404 Not Found",
      },
    ]);
    await expect(readFile(join(root, "bundle-1", "001-app.js"), "utf8"))
      .resolves.toBe("console.log('ok');");
    await expect(readFile(result.manifestPath, "utf8").then(JSON.parse))
      .resolves.toEqual({
        assets: result.assets,
        browser: "iab",
        tabId: tab.id,
      });
  });
});

describe("defaultBrowserUrlPolicy", () => {
  it("matches the black-box Browser URL boundary", () => {
    expect(defaultBrowserUrlPolicy("http://127.0.0.1:3000/").allowed).toBe(true);
    expect(defaultBrowserUrlPolicy("https://example.com/").allowed).toBe(true);
    expect(defaultBrowserUrlPolicy("about:blank").allowed).toBe(true);
    expect(defaultBrowserUrlPolicy("data:text/html,blocked")).toMatchObject({
      allowed: false,
      reason: "blocked protocol: data:",
    });
    expect(defaultBrowserUrlPolicy("file:///tmp/probe.html")).toMatchObject({
      allowed: false,
      reason: "blocked protocol: file:",
    });
  });
});

function fakeAdapter(options: {
  id: string;
  type: BrowserDescriptor["type"];
  name: string;
  browserCapabilities?: string[];
  tabCapabilities?: string[];
  screenshotBytes?: Uint8Array;
  logs?: Awaited<ReturnType<BrowserBackendAdapter["devLogs"]>>;
  pageAssets?: Awaited<ReturnType<NonNullable<BrowserBackendAdapter["pageAssets"]>>>;
  locators?: boolean;
  userTabs?: BrowserTabInfo[];
}): BrowserBackendAdapter & {
  navigate: ReturnType<typeof vi.fn<BrowserBackendAdapter["navigate"]>>;
  activeDialog: Awaited<ReturnType<NonNullable<BrowserBackendAdapter["getDialog"]>>>;
  locatorCalls: unknown[];
} {
  let seq = 0;
  let visible = false;
  const tabs = new Map<string, BrowserTabInfo>();
  const history = new Map<string, { entries: BrowserTabInfo[]; index: number }>();
  const descriptor: BrowserDescriptor = {
    id: options.id,
    type: options.type,
    name: options.name,
    capabilities: {
      browser: (options.browserCapabilities ?? []).map((id) => ({ id, description: `${id} capability` })),
      tab: (options.tabCapabilities ?? []).map((id) => ({ id, description: `${id} capability` })),
    },
  };
  const navigate = vi.fn<BrowserBackendAdapter["navigate"]>(async (tabId, url) => {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error(`missing tab: ${tabId}`);
    const next = { ...tab, url, title: url };
    tabs.set(tabId, next);
    const state = history.get(tabId) ?? { entries: [tab], index: 0 };
    state.entries = [...state.entries.slice(0, state.index + 1), next];
    state.index = state.entries.length - 1;
    history.set(tabId, state);
    return next;
  });

  const adapter: BrowserBackendAdapter & {
    navigate: ReturnType<typeof vi.fn<BrowserBackendAdapter["navigate"]>>;
    activeDialog: Awaited<ReturnType<NonNullable<BrowserBackendAdapter["getDialog"]>>>;
    locatorCalls: unknown[];
  } = {
    activeDialog: null,
    locatorCalls: [],
    descriptor,
    listTabs: async () => [...tabs.values()],
    userTabs: async () => options.userTabs ?? [],
    createTab: async () => {
      const tab = { id: String(++seq), title: "about:blank", url: "about:blank" };
      tabs.set(tab.id, tab);
      history.set(tab.id, { entries: [tab], index: 0 });
      return tab;
    },
    getTab: async (tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`missing tab: ${tabId}`);
      return tab;
    },
    closeTab: async (tabId) => {
      tabs.delete(tabId);
      history.delete(tabId);
    },
    navigate,
    reload: async (tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`missing tab: ${tabId}`);
      return tab;
    },
    back: async (tabId) => {
      const state = history.get(tabId);
      if (!state) throw new Error(`missing tab: ${tabId}`);
      state.index = Math.max(0, state.index - 1);
      const tab = state.entries[state.index]!;
      tabs.set(tabId, tab);
      return tab;
    },
    forward: async (tabId) => {
      const state = history.get(tabId);
      if (!state) throw new Error(`missing tab: ${tabId}`);
      state.index = Math.min(state.entries.length - 1, state.index + 1);
      const tab = state.entries[state.index]!;
      tabs.set(tabId, tab);
      return tab;
    },
    screenshot: async () => options.screenshotBytes ?? Uint8Array.from([]),
    domSnapshot: async () => "Ping\nName",
    evaluate: async () => "Probe",
    click: async () => undefined,
    type: async () => undefined,
    press: async () => undefined,
    coordinateClick: async (tabId, x, y) => {
      adapter.locatorCalls.push(["coordinateClick", tabId, x, y]);
    },
    domCuaSnapshot: async () => '<button node_id="1">Ping</button>',
    domCuaClick: async (tabId, nodeId) => {
      adapter.locatorCalls.push(["domCuaClick", tabId, nodeId]);
    },
    getDialog: async () => adapter.activeDialog,
    acceptDialog: async () => {
      adapter.activeDialog = null;
    },
    dismissDialog: async () => {
      adapter.activeDialog = null;
    },
    pageAssets: async () => options.pageAssets ?? [
      { url: "http://127.0.0.1:5173/app.js", type: "script" },
      { url: "http://127.0.0.1:5173/logo.png", type: "image" },
    ],
    locatorCount: options.locators === false
      ? undefined
      : async (tabId, locator) => {
        adapter.locatorCalls.push(["count", tabId, locator]);
        return 2;
      },
    locatorClick: options.locators === false
      ? undefined
      : async (tabId, locator) => {
        adapter.locatorCalls.push(["click", tabId, locator]);
      },
    locatorFill: options.locators === false
      ? undefined
      : async (tabId, locator, text) => {
        adapter.locatorCalls.push(["fill", tabId, locator, text]);
      },
    locatorPress: options.locators === false
      ? undefined
      : async (tabId, locator, key) => {
        adapter.locatorCalls.push(["press", tabId, locator, key]);
      },
    locatorSetChecked: options.locators === false
      ? undefined
      : async (tabId, locator, checked) => {
        adapter.locatorCalls.push(["setChecked", tabId, locator, checked]);
      },
    locatorSelectOption: options.locators === false
      ? undefined
      : async (tabId, locator, value) => {
        adapter.locatorCalls.push(["selectOption", tabId, locator, value]);
      },
    locatorInnerText: options.locators === false
      ? undefined
      : async (tabId, locator) => {
        adapter.locatorCalls.push(["innerText", tabId, locator]);
        return "Submit";
      },
    locatorAttribute: options.locators === false
      ? undefined
      : async (tabId, locator, name) => {
        adapter.locatorCalls.push(["attribute", tabId, locator, name]);
        return "ready";
      },
    setViewport: options.browserCapabilities?.includes("viewport")
      ? async () => undefined
      : undefined,
    resetViewport: options.browserCapabilities?.includes("viewport")
      ? async () => undefined
      : undefined,
    setVisibility: options.browserCapabilities?.includes("visibility")
      ? async (nextVisible) => {
        visible = nextVisible;
      }
      : undefined,
    getVisibility: options.browserCapabilities?.includes("visibility")
      ? async () => visible
      : undefined,
    devLogs: async () => options.logs ?? [],
  };
  return adapter;
}

function fakeFetchResponse(options: {
  ok: boolean;
  status: number;
  statusText?: string;
  mimeType?: string;
  body: string;
}) {
  return {
    ok: options.ok,
    status: options.status,
    statusText: options.statusText ?? "",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? options.mimeType ?? null
          : null,
    },
    async arrayBuffer() {
      const bytes = new TextEncoder().encode(options.body);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}
