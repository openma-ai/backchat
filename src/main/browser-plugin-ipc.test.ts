import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { InvokeChannel } from "../shared/ipc-channels.js";
import {
  createBrowserPluginService,
  type BrowserBackendAdapter,
  type BrowserLocatorDescriptor,
} from "./browser-plugin-service.js";
import { registerBrowserPluginIpc, type BrowserPluginIpcMain } from "./browser-plugin-ipc.js";

describe("registerBrowserPluginIpc", () => {
  it("exposes browser discovery and tab operations through typed invoke channels", async () => {
    const ipc = fakeIpcMain();
    const bundleRoot = await mkdtemp(join(tmpdir(), "backchat-browser-ipc-"));
    let clipboardText = "";
    const service = createBrowserPluginService({
      adapters: [fakeAdapter()],
      assetBundleRoot: bundleRoot,
      bundleId: () => "bundle-1",
      fetch: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "application/javascript" },
        async arrayBuffer() {
          const bytes = new TextEncoder().encode("ok");
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      }),
      clipboard: {
        readText: async () => clipboardText,
        writeText: async (text) => {
          clipboardText = text;
        },
      },
    });
    registerBrowserPluginIpc(ipc, service, {
      resolveHostWindow: (event) => event,
    });

    await expect(invoke(ipc, InvokeChannel.BrowserList)).resolves.toEqual([
      {
        id: "iab-1",
        name: "Backchat In-app Browser",
        type: "iab",
        capabilities: { browser: [], tab: [] },
      },
    ]);
    await expect(invoke(ipc, InvokeChannel.BrowserGet, { browser: "iab" }))
      .resolves.toEqual({
        id: "iab-1",
        name: "Backchat In-app Browser",
        type: "iab",
        capabilities: { browser: [], tab: [] },
      });

    const tab = await invoke(ipc, InvokeChannel.BrowserNewTab, { browser: "iab" });
    expect(tab).toEqual({ id: "1", title: "about:blank", url: "about:blank" });
    await expect(invoke(ipc, InvokeChannel.BrowserGetTab, { browser: "iab", tabId: "1" }))
      .resolves.toEqual(tab);
    await expect(invoke(ipc, InvokeChannel.BrowserSelectedTab, { browser: "iab" }))
      .resolves.toEqual(tab);
    await expect(invoke(ipc, InvokeChannel.BrowserUserOpenTabs, { browser: "iab" }))
      .resolves.toEqual([]);

    await expect(invoke(ipc, InvokeChannel.BrowserGoto, {
      browser: "iab",
      tabId: "1",
      url: "http://127.0.0.1:5173/",
    })).resolves.toEqual({
      id: "1",
      title: "http://127.0.0.1:5173/",
      url: "http://127.0.0.1:5173/",
    });
    await expect(invoke(ipc, InvokeChannel.BrowserSelectTab, {
      browser: "iab",
      tabId: "1",
    })).resolves.toEqual({
      id: "1",
      title: "http://127.0.0.1:5173/",
      url: "http://127.0.0.1:5173/",
    });
    await expect(invoke(ipc, InvokeChannel.BrowserSetVisibility, {
      browser: "iab",
      visible: true,
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserGetVisibility, {
      browser: "iab",
    })).resolves.toBe(true);
    await expect(invoke(ipc, InvokeChannel.BrowserNameSession, {
      browser: "iab",
      name: "Fixture checkout",
    })).resolves.toEqual({
      browser: "iab-1",
      name: "Fixture checkout",
    });
    await expect(invoke(ipc, InvokeChannel.BrowserSessionName, {
      browser: "iab",
    })).resolves.toBe("Fixture checkout");
    await expect(invoke(ipc, InvokeChannel.BrowserSetViewport, {
      browser: "iab",
      width: 390,
      height: 640,
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserResetViewport, {
      browser: "iab",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserAttachView, {
      browser: "iab",
      tabId: "1",
      bounds: { x: 10, y: 20, width: 320, height: 480 },
      visible: true,
    }, { id: "host-window" })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserDetachView, {
      browser: "iab",
      tabId: "1",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserWaitForURL, {
      browser: "iab",
      tabId: "1",
      url: "http://127.0.0.1:5173/",
      waitUntil: "domcontentloaded",
      timeoutMs: 100,
      pollMs: 1,
    })).resolves.toEqual({
      id: "1",
      title: "http://127.0.0.1:5173/",
      url: "http://127.0.0.1:5173/",
    });

    await expect(invoke(ipc, InvokeChannel.BrowserScreenshot, {
      browser: "iab",
      tabId: "1",
    })).resolves.toEqual({
      base64: "/9j/",
      mimeType: "image/jpeg",
    });

    await expect(invoke(ipc, InvokeChannel.BrowserTitle, {
      browser: "iab",
      tabId: "1",
    })).resolves.toBe("http://127.0.0.1:5173/");
    await expect(invoke(ipc, InvokeChannel.BrowserUrl, {
      browser: "iab",
      tabId: "1",
    })).resolves.toBe("http://127.0.0.1:5173/");
    await expect(invoke(ipc, InvokeChannel.BrowserPageAssets, {
      browser: "iab",
      tabId: "1",
    })).resolves.toEqual([
      { url: "http://127.0.0.1:5173/app.js", type: "script" },
    ]);
    await expect(invoke(ipc, InvokeChannel.BrowserDomSnapshot, {
      browser: "iab",
      tabId: "1",
    })).resolves.toBe("Submit\nName");
    await expect(invoke(ipc, InvokeChannel.BrowserEvaluate, {
      browser: "iab",
      tabId: "1",
      expression: "document.title",
    })).resolves.toBe("Fixture");
    await expect(invoke(ipc, InvokeChannel.BrowserClick, {
      browser: "iab",
      tabId: "1",
      selector: "#submit",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserType, {
      browser: "iab",
      tabId: "1",
      selector: "#name",
      text: "Ada",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserPress, {
      browser: "iab",
      tabId: "1",
      key: "Enter",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserCuaClick, {
      browser: "iab",
      tabId: "1",
      x: 12,
      y: 24,
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserDomCuaSnapshot, {
      browser: "iab",
      tabId: "1",
    })).resolves.toBe('<button node_id="1">Submit</button>');
    await expect(invoke(ipc, InvokeChannel.BrowserDomCuaClick, {
      browser: "iab",
      tabId: "1",
      nodeId: "1",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserLocatorCount, {
      browser: "iab",
      tabId: "1",
      locator: { kind: "role", role: "button", name: "Submit", exact: true },
    })).resolves.toBe(2);
    await expect(invoke(ipc, InvokeChannel.BrowserLocatorInnerText, {
      browser: "iab",
      tabId: "1",
      locator: { kind: "text", value: "Submit", exact: true },
    })).resolves.toBe("Submit");
    await expect(invoke(ipc, InvokeChannel.BrowserLocatorAttribute, {
      browser: "iab",
      tabId: "1",
      locator: { kind: "testId", value: "submit-button" },
      name: "data-state",
    })).resolves.toBe("ready");
    await expect(invoke(ipc, InvokeChannel.BrowserLocatorClick, {
      browser: "iab",
      tabId: "1",
      locator: { kind: "role", role: "button", name: "Submit" },
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserLocatorFill, {
      browser: "iab",
      tabId: "1",
      locator: { kind: "label", value: "Name" },
      text: "Ada",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserLocatorPress, {
      browser: "iab",
      tabId: "1",
      locator: { kind: "text", value: "Submit" },
      key: "Enter",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserLocatorSetChecked, {
      browser: "iab",
      tabId: "1",
      locator: { kind: "label", value: "Subscribe" },
      checked: true,
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserLocatorSelectOption, {
      browser: "iab",
      tabId: "1",
      locator: { kind: "label", value: "Mode" },
      value: "auto",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserBundleAssets, {
      browser: "iab",
      tabId: "1",
    })).resolves.toEqual({
      directory: join(bundleRoot, "bundle-1"),
      manifestPath: join(bundleRoot, "bundle-1", "manifest.json"),
      assets: [
        {
          url: "http://127.0.0.1:5173/app.js",
          type: "script",
          status: "saved",
          path: join(bundleRoot, "bundle-1", "001-app.js"),
          mimeType: "application/javascript",
          byteSize: 2,
        },
      ],
    });
    await expect(invoke(ipc, InvokeChannel.BrowserReload, {
      browser: "iab",
      tabId: "1",
    })).resolves.toMatchObject({ id: "1" });
    await expect(invoke(ipc, InvokeChannel.BrowserBack, {
      browser: "iab",
      tabId: "1",
    })).resolves.toMatchObject({ id: "1" });
    await expect(invoke(ipc, InvokeChannel.BrowserForward, {
      browser: "iab",
      tabId: "1",
    })).resolves.toMatchObject({ id: "1" });
    await expect(invoke(ipc, InvokeChannel.BrowserClipboardWriteText, {
      text: "copied",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserClipboardReadText))
      .resolves.toBe("copied");
  });

  it("exposes JavaScript dialog inspection and handling channels", async () => {
    const ipc = fakeIpcMain();
    registerBrowserPluginIpc(ipc, createBrowserPluginService({
      adapters: [dialogAdapter()],
    }));
    await invoke(ipc, InvokeChannel.BrowserNewTab, { browser: "iab" });

    await expect(invoke(ipc, InvokeChannel.BrowserDialog, {
      browser: "iab",
      tabId: "1",
    })).resolves.toEqual({
      type: "alert",
      message: "Hello",
    });
    await expect(invoke(ipc, InvokeChannel.BrowserAcceptDialog, {
      browser: "iab",
      tabId: "1",
      promptText: "typed",
    })).resolves.toBeUndefined();
    await expect(invoke(ipc, InvokeChannel.BrowserDismissDialog, {
      browser: "iab",
      tabId: "1",
    })).resolves.toBeUndefined();
  });

  it("preserves locator indexes through IPC payload validation", async () => {
    const ipc = fakeIpcMain();
    const locators: BrowserLocatorDescriptor[] = [];
    registerBrowserPluginIpc(ipc, createBrowserPluginService({
      adapters: [{
        ...fakeAdapter(),
        locatorClick: async (_tabId, locator) => {
          locators.push(locator);
        },
      }],
    }));

    await expect(invoke(ipc, InvokeChannel.BrowserLocatorClick, {
      browser: "iab",
      tabId: "1",
      locator: {
        kind: "frame",
        index: 3,
        frame: { kind: "testId", value: "duplicate-frame", index: 1 },
        locator: { kind: "role", role: "button", name: "Ping", index: 2 },
      },
    })).resolves.toBeUndefined();

    expect(locators).toEqual([{
      kind: "frame",
      index: 3,
      frame: { kind: "testId", value: "duplicate-frame", index: 1 },
      locator: { kind: "role", role: "button", name: "Ping", index: 2 },
    }]);
  });

  it("passes dev log filter options through the Browser IPC channel", async () => {
    const ipc = fakeIpcMain();
    const pageUrl = "http://127.0.0.1:5173/";
    registerBrowserPluginIpc(ipc, createBrowserPluginService({
      adapters: [{
        ...fakeAdapter(),
        devLogs: async () => [
          {
            level: "warn",
            message: "extension noise",
            timestamp: "2026-07-02T00:00:00.000Z",
            url: "chrome-extension://abc/content.js",
          },
          {
            level: "log",
            message: "fixture ready",
            timestamp: "2026-07-02T00:00:01.000Z",
            url: pageUrl,
          },
          {
            level: "error",
            message: "fixture failed",
            timestamp: "2026-07-02T00:00:02.000Z",
            url: pageUrl,
          },
        ],
      }],
    }));

    await expect(invoke(ipc, InvokeChannel.BrowserDevLogs, {
      browser: "iab",
      tabId: "1",
      pageUrl,
      levels: ["log", "error"],
      filter: "fixture",
      limit: 1,
    })).resolves.toEqual([
      {
        level: "error",
        message: "fixture failed",
        timestamp: "2026-07-02T00:00:02.000Z",
        url: pageUrl,
      },
    ]);
  });

  it("passes screenshot options through the Browser IPC channel", async () => {
    const ipc = fakeIpcMain();
    const screenshotOptions: unknown[] = [];
    registerBrowserPluginIpc(ipc, createBrowserPluginService({
      adapters: [{
        ...fakeAdapter(),
        screenshot: async (_tabId, options) => {
          screenshotOptions.push(options);
          return Uint8Array.from([0xff, 0xd8, 0xff]);
        },
      }],
    }));

    await expect(invoke(ipc, InvokeChannel.BrowserScreenshot, {
      browser: "iab",
      tabId: "1",
      options: {
        clip: { x: 10, y: 20, width: 320, height: 180 },
        fullPage: true,
      },
    })).resolves.toEqual({
      base64: "/9j/",
      mimeType: "image/jpeg",
    });

    expect(screenshotOptions).toEqual([{
      clip: { x: 10, y: 20, width: 320, height: 180 },
      fullPage: true,
    }]);
  });

  it("passes load-state wait options through the Browser IPC channel", async () => {
    const ipc = fakeIpcMain();
    registerBrowserPluginIpc(ipc, createBrowserPluginService({
      adapters: [{
        ...fakeAdapter(),
        evaluate: async () => "complete",
      }],
    }));
    await invoke(ipc, InvokeChannel.BrowserNewTab, { browser: "iab" });

    await expect(invoke(ipc, InvokeChannel.BrowserWaitForLoadState, {
      browser: "iab",
      tabId: "1",
      state: "load",
      timeoutMs: 100,
      pollMs: 1,
    })).resolves.toEqual({
      id: "1",
      title: "about:blank",
      url: "about:blank",
    });
  });

  it("propagates URL policy errors instead of navigating", async () => {
    const ipc = fakeIpcMain();
    registerBrowserPluginIpc(ipc, createBrowserPluginService({
      adapters: [fakeAdapter()],
    }));
    await invoke(ipc, InvokeChannel.BrowserNewTab, { browser: "iab" });

    await expect(invoke(ipc, InvokeChannel.BrowserGoto, {
      browser: "iab",
      tabId: "1",
      url: "data:text/html,blocked",
    })).rejects.toMatchObject({
      code: "BROWSER_URL_BLOCKED",
    });
  });
});

function fakeIpcMain(): BrowserPluginIpcMain & {
  handlers: Map<string, (event: unknown, payload: unknown) => unknown>;
} {
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler as (event: unknown, payload: unknown) => unknown);
    },
  };
}

async function invoke(
  ipc: ReturnType<typeof fakeIpcMain>,
  channel: string,
  payload?: unknown,
  event: unknown = {},
): Promise<unknown> {
  const handler = ipc.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return handler(event, payload);
}

function fakeAdapter(): BrowserBackendAdapter {
  const tabs = new Map<string, { id: string; title: string; url: string }>();
  let visible = false;
  return {
    descriptor: {
      id: "iab-1",
      name: "Backchat In-app Browser",
      type: "iab",
      capabilities: { browser: [], tab: [] },
    },
    listTabs: async () => [...tabs.values()],
    createTab: async () => {
      const tab = { id: "1", title: "about:blank", url: "about:blank" };
      tabs.set(tab.id, tab);
      return tab;
    },
    getTab: async (tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`missing tab: ${tabId}`);
      return tab;
    },
    closeTab: async (tabId) => {
      tabs.delete(tabId);
    },
    navigate: async (tabId, url) => {
      const tab = { id: tabId, title: url, url };
      tabs.set(tabId, tab);
      return tab;
    },
    reload: async (tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`missing tab: ${tabId}`);
      return tab;
    },
    back: async (tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`missing tab: ${tabId}`);
      return tab;
    },
    forward: async (tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`missing tab: ${tabId}`);
      return tab;
    },
    screenshot: async () => Uint8Array.from([0xff, 0xd8, 0xff]),
    setViewport: async () => undefined,
    resetViewport: async () => undefined,
    setVisibility: async (nextVisible) => {
      visible = nextVisible;
    },
    getVisibility: async () => visible,
    attachView: async () => undefined,
    detachView: async () => undefined,
    devLogs: async () => [],
    pageAssets: async () => [
      { url: "http://127.0.0.1:5173/app.js", type: "script" },
    ],
    domSnapshot: async () => "Submit\nName",
    evaluate: async (_tabId, expression) =>
      expression === "document.readyState" ? "complete" : "Fixture",
    click: async () => undefined,
    type: async () => undefined,
    press: async () => undefined,
    coordinateClick: async () => undefined,
    domCuaSnapshot: async () => '<button node_id="1">Submit</button>',
    domCuaClick: async () => undefined,
    locatorCount: async () => 2,
    locatorClick: async () => undefined,
    locatorFill: async () => undefined,
    locatorPress: async () => undefined,
    locatorSetChecked: async () => undefined,
    locatorSelectOption: async () => undefined,
    locatorInnerText: async () => "Submit",
    locatorAttribute: async () => "ready",
  };
}

function dialogAdapter(): BrowserBackendAdapter {
  return {
    ...fakeAdapter(),
    getDialog: async () => ({ type: "alert", message: "Hello" }),
    acceptDialog: async () => undefined,
    dismissDialog: async () => undefined,
  };
}
