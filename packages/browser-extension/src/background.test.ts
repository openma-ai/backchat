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

  it("resolves locator commands inside open shadow roots", async () => {
    const document = createShadowLocatorDocument();
    const worker = loadBackgroundWorker({ scriptDocument: document });

    await expect(worker.sendCommand({
      id: "cmd-shadow-count",
      type: "tab.locatorCount",
      tabId: "7",
      locator: { kind: "testId", value: "shadow-button" },
    })).resolves.toEqual({ ok: true, result: 1 });
    await expect(worker.sendCommand({
      id: "cmd-shadow-text",
      type: "tab.locatorInnerText",
      tabId: "7",
      locator: { kind: "testId", value: "shadow-button" },
    })).resolves.toEqual({ ok: true, result: "Shadow Submit" });
  });
});

function loadBackgroundWorker(options: {
  storage?: Record<string, unknown>;
  scriptDocument?: FakeLocatorDocument;
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
  const executeInjectedScript = vi.fn(async (details: {
    func?: (...args: unknown[]) => unknown;
    args?: unknown[];
  } = {}) => {
    if (options.scriptDocument && typeof details.func === "function") {
      return [{ result: details.func(...(details.args ?? [])) }];
    }
    return [{
      result: {
        scrollX: 12,
        scrollY: 34,
        viewportWidth: 1265,
        viewportHeight: 720,
        documentWidth: 1265,
        documentHeight: 9000,
      },
    }];
  });
  const window = {
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  };
  if (options.scriptDocument) {
    options.scriptDocument.defaultView = window;
  }
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
      executeScript: executeInjectedScript,
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
    document: options.scriptDocument,
    window,
    Event: class FakeEvent {},
    InputEvent: class FakeInputEvent {},
    KeyboardEvent: class FakeKeyboardEvent {},
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

function createShadowLocatorDocument() {
  const document = new FakeLocatorDocument();
  const host = document.createElement("shadow-card", {}, "");
  const shadowRoot = host.attachShadow();
  shadowRoot.appendChild(document.createElement("button", {
    "data-testid": "shadow-button",
  }, "Shadow Submit"));
  document.body.appendChild(host);
  return document;
}

class FakeLocatorDocument {
  defaultView: unknown = null;
  readonly body = new FakeLocatorElement(this, "body", {}, "");

  createElement(
    tagName: string,
    attributes: Record<string, string> = {},
    textContent = "",
  ): FakeLocatorElement {
    return new FakeLocatorElement(this, tagName, attributes, textContent);
  }

  querySelectorAll(selector: string): FakeLocatorElement[] {
    return queryLocatorElements(this.body.children, selector);
  }

  getElementById(id: string): FakeLocatorElement | null {
    return queryLocatorElements(this.body.children, "*")
      .find((element) => element.getAttribute("id") === id) ?? null;
  }
}

class FakeLocatorShadowRoot {
  readonly children: FakeLocatorElement[] = [];

  constructor(readonly ownerDocument: FakeLocatorDocument) {}

  appendChild(element: FakeLocatorElement): void {
    element.parentElement = null;
    this.children.push(element);
  }

  querySelectorAll(selector: string): FakeLocatorElement[] {
    return queryLocatorElements(this.children, selector);
  }

  getElementById(id: string): FakeLocatorElement | null {
    return queryLocatorElements(this.children, "*")
      .find((element) => element.getAttribute("id") === id) ?? null;
  }
}

class FakeLocatorElement {
  readonly nodeType = 1;
  readonly children: FakeLocatorElement[] = [];
  parentElement: FakeLocatorElement | null = null;
  shadowRoot: FakeLocatorShadowRoot | null = null;

  constructor(
    readonly ownerDocument: FakeLocatorDocument,
    readonly tagName: string,
    private readonly attributes: Record<string, string>,
    readonly textContent: string,
  ) {}

  get innerText(): string {
    return this.textContent;
  }

  appendChild(element: FakeLocatorElement): void {
    element.parentElement = this;
    this.children.push(element);
  }

  attachShadow(): FakeLocatorShadowRoot {
    this.shadowRoot = new FakeLocatorShadowRoot(this.ownerDocument);
    return this.shadowRoot;
  }

  querySelectorAll(selector: string): FakeLocatorElement[] {
    return queryLocatorElements(this.children, selector);
  }

  contains(candidate: FakeLocatorElement): boolean {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  matches(selector: string): boolean {
    return selector.split(",").some((part) =>
      locatorElementMatchesSelector(this, part.trim())
    );
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 80, height: 24 };
  }

  scrollIntoView(): void {}

  focus(): void {}

  click(): void {}
}

function queryLocatorElements(elements: FakeLocatorElement[], selector: string): FakeLocatorElement[] {
  const candidates: FakeLocatorElement[] = [];
  for (const element of elements) {
    candidates.push(element, ...queryLocatorElements(element.children, "*"));
  }
  if (selector === "*" || selector === "body *") return candidates;
  const selectors = selector.split(",").map((part) => part.trim());
  return candidates.filter((element) =>
    selectors.some((part) => locatorElementMatchesSelector(element, part))
  );
}

function locatorElementMatchesSelector(element: FakeLocatorElement, selector: string): boolean {
  if (selector === "*") return true;
  if (selector === "[data-testid]" || selector === "[data-test-id]" || selector === "[data-test]") {
    return element.hasAttribute(selector.slice(1, -1));
  }
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const [name, rawValue] = selector.slice(1, -1).split("=");
    if (!name) return false;
    if (!rawValue) return element.hasAttribute(name);
    return element.getAttribute(name) === rawValue.replace(/^"|"$/g, "");
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}
