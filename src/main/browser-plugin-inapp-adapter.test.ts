import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import {
  __browserPluginInAppAdapterTest,
  createElectronInAppBrowserAdapter,
} from "./browser-plugin-inapp-adapter.js";

describe("createElectronInAppBrowserAdapter", () => {
  it("advertises IAB capabilities and creates sandboxed background tabs", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
      now: () => "2026-07-02T00:00:00.000Z",
    });

    expect(adapter.descriptor).toMatchObject({
      id: "backchat-iab",
      type: "iab",
      name: "Backchat In-app Browser",
      capabilities: {
        browser: [
          { id: "visibility", description: expect.any(String) },
          { id: "viewport", description: expect.any(String) },
          { id: "viewAttach", description: expect.any(String) },
        ],
        tab: expect.arrayContaining([
          { id: "pageAssets", description: expect.any(String) },
        ]),
      },
    });
    expect(adapter.descriptor.capabilities.tab.map((capability) => capability.id))
      .toEqual([
        "history",
        "pageAssets",
        "domSnapshot",
        "evaluate",
        "input",
        "cua",
        "domCua",
        "dialogs",
        "locators",
      ]);

    const tab = await adapter.createTab();

    expect(tab).toEqual({ id: "1", title: "about:blank", url: "about:blank" });
    expect(fake.windows).toHaveLength(1);
    expect(fake.windows[0]?.options).toMatchObject({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  });

  it("navigates, captures JPEG screenshots, records logs, and closes tabs", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
      now: () => "2026-07-02T00:00:00.000Z",
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;

    await expect(adapter.navigate(tab.id, "http://127.0.0.1:5173/"))
      .resolves.toEqual({
        id: "1",
        title: "Probe",
        url: "http://127.0.0.1:5173/",
      });
    win.webContents.emit("console-message", {
      level: "warning",
      message: "probe-warn",
      sourceId: "http://127.0.0.1:5173/",
    });

    await expect(adapter.screenshot(tab.id)).resolves.toEqual({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
    });
    await expect(adapter.devLogs(tab.id)).resolves.toEqual([
      {
        level: "warn",
        message: "probe-warn",
        timestamp: "2026-07-02T00:00:00.000Z",
        url: "http://127.0.0.1:5173/",
      },
    ]);

    await adapter.closeTab(tab.id);
    expect(win.closed).toBe(true);
    await expect(adapter.listTabs()).resolves.toEqual([]);
  });

  it("supports reload/back/forward history controls", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;

    await adapter.navigate(tab.id, "https://example.com/one");
    await adapter.navigate(tab.id, "https://example.com/two");
    await expect(adapter.back?.(tab.id)).resolves.toMatchObject({
      url: "https://example.com/one",
    });
    await expect(adapter.forward?.(tab.id)).resolves.toMatchObject({
      url: "https://example.com/two",
    });
    await expect(adapter.reload?.(tab.id)).resolves.toMatchObject({
      url: "https://example.com/two",
    });
    expect(win.reloadCalls).toBe(1);
  });

  it("supports viewport and visibility controls on the owned browser windows", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    await adapter.createTab();
    const win = fake.windows[0]!;

    await adapter.setViewport?.({ width: 390, height: 640 });
    expect(win.bounds).toMatchObject({ width: 390, height: 640 });
    await adapter.resetViewport?.();
    expect(win.bounds).toMatchObject({ width: 1280, height: 720 });

    await expect(adapter.getVisibility?.()).resolves.toBe(false);
    await adapter.setVisibility?.(true);
    expect(win.visible).toBe(true);
    await expect(adapter.getVisibility?.()).resolves.toBe(true);
    await adapter.setVisibility?.(false);
    expect(win.visible).toBe(false);
  });

  it("applies the configured viewport to tabs created after viewport_set", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });

    await adapter.setViewport?.({ width: 960, height: 640 });
    const tab = await adapter.createTab();

    expect(tab).toEqual({ id: "1", title: "about:blank", url: "about:blank" });
    expect(fake.windows[0]?.options).toMatchObject({ width: 960, height: 640 });
    expect(fake.windows[0]?.bounds).toEqual({ width: 960, height: 640 });
  });

  it("normalizes screenshot images to the current viewport CSS size", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;

    await adapter.setViewport?.({ width: 960, height: 640 });
    win.nextCapturedImage = new FakeCapturedImage({ width: 2560, height: 1440 });

    await expect(adapter.screenshot(tab.id)).resolves.toEqual({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
    });
    expect(win.nextCapturedImage.resizeCalls).toEqual([
      { width: 960, height: 640, quality: "best" },
    ]);
  });

  it("captures full-page screenshots by resizing to document dimensions and restoring viewport", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;

    win.webContents.scriptResults.push({
      width: 1500,
      height: 2200,
      scrollX: 5,
      scrollY: 8,
    });
    await expect(adapter.screenshot(tab.id, { fullPage: true })).resolves.toEqual({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
    });

    expect(win.setSizeCalls).toEqual([
      { width: 1500, height: 2200 },
      { width: 1280, height: 720 },
    ]);
    expect(win.capturePageSizes).toEqual([
      { width: 1500, height: 2200 },
    ]);
    expect(win.bounds).toEqual({ width: 1280, height: 720 });
    expect(win.webContents.scripts.join("\n")).toContain("scrollTo(0, 0)");
    expect(win.webContents.scripts.join("\n")).toContain("scrollTo(5, 8)");
  });

  it("temporarily shows hidden tabs before measuring full-page screenshot dimensions", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;

    win.webContents.scriptResults.push({
      width: 1280,
      height: 1800,
      scrollX: 0,
      scrollY: 0,
    });
    await expect(adapter.screenshot(tab.id, { fullPage: true })).resolves.toMatchObject({
      mimeType: "image/jpeg",
    });

    expect(win.showCalls).toBe(1);
    expect(win.hideCalls).toBe(1);
    expect(win.visible).toBe(false);
  });

  it("shows and hides the parking window when a WebContentsView tab is not attached", () => {
    const view = {
      webContents: new FakeWebContents(),
      bounds: null as null | { x: number; y: number; width: number; height: number },
      visible: false,
      setBounds(bounds: { x: number; y: number; width: number; height: number }) {
        this.bounds = bounds;
      },
      setVisible(visible: boolean) {
        this.visible = visible;
      },
    };
    const parkingWindow = {
      contentView: new FakeContentView(),
      centered: false,
      visible: false,
      closed: false,
      close() {
        this.closed = true;
      },
      center() {
        this.centered = true;
      },
      hide() {
        this.visible = false;
      },
      isVisible() {
        return this.visible;
      },
      show() {
        this.visible = true;
      },
      setSize() {},
    };
    const host = new __browserPluginInAppAdapterTest.WebContentsViewHost(
      view,
      { width: 1280, height: 720, visible: false },
      parkingWindow,
    );

    host.show();
    expect(view.visible).toBe(true);
    expect(parkingWindow.centered).toBe(true);
    expect(parkingWindow.visible).toBe(true);
    expect(host.isVisible()).toBe(true);

    host.hide();
    expect(view.visible).toBe(false);
    expect(parkingWindow.visible).toBe(false);
    expect(host.isVisible()).toBe(false);
  });

  it("attaches and detaches tab surfaces to a host window", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;
    const hostWindow = { id: "host-window" };
    const bounds = { x: 10, y: 20, width: 320, height: 480 };

    await adapter.attachView?.(tab.id, { hostWindow, bounds, visible: true });
    expect(win.attachCalls).toEqual([{ hostWindow, bounds, visible: true }]);

    await adapter.detachView?.(tab.id);
    expect(win.detachCalls).toBe(1);
  });

  it("runs DOM inspection and input actions through the tab webContents", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;

    win.webContents.scriptResults.push("Ping\nName");
    await expect(adapter.domSnapshot?.(tab.id)).resolves.toBe("Ping\nName");

    win.webContents.scriptResults.push("Probe");
    await expect(adapter.evaluate?.(tab.id, "document.title")).resolves.toBe("Probe");

    await expect(adapter.click?.(tab.id, "#ping")).resolves.toBeUndefined();
    await expect(adapter.type?.(tab.id, "#name", "Ada")).resolves.toBeUndefined();
    await expect(adapter.press?.(tab.id, "Enter")).resolves.toBeUndefined();
    win.webContents.scriptResults.push({ ok: true });
    await expect(adapter.coordinateClick?.(tab.id, 120, 80)).resolves.toBeUndefined();
    await adapter.setVisibility?.(true);
    await expect(adapter.coordinateClick?.(tab.id, 130, 90)).resolves.toBeUndefined();

    win.webContents.scriptResults.push('<button node_id="1">Ping</button>');
    await expect(adapter.domCuaSnapshot?.(tab.id)).resolves.toBe('<button node_id="1">Ping</button>');
    await expect(adapter.domCuaClick?.(tab.id, "1")).resolves.toBeUndefined();

    expect(win.webContents.scripts.join("\n")).toContain("#ping");
    expect(win.webContents.scripts.join("\n")).toContain("#name");
    expect(win.webContents.scripts.join("\n")).toContain("elementFromPoint");
    expect(win.webContents.scripts.join("\n")).toContain("node_id");
    expect(win.webContents.inputEvents).toEqual([
      { type: "keyDown", keyCode: "Enter" },
      { type: "keyUp", keyCode: "Enter" },
      { type: "mouseDown", x: 130, y: 90, button: "left", clickCount: 1 },
      { type: "mouseUp", x: 130, y: 90, button: "left", clickCount: 1 },
    ]);
  });

  it("clicks the nearest interactable element when coordinate hit testing is slightly outside", () => {
    const events: Array<{ type: string; clientX: number; clientY: number }> = [];
    class FakeElement {}
    class FakeMouseEvent {
      constructor(readonly type: string, readonly init: { clientX: number; clientY: number }) {}
    }
    const button = {
      disabled: false,
      nodeType: 1,
      tagName: "BUTTON",
      getAttribute: () => null,
      getBoundingClientRect: () => ({
        left: 40,
        right: 80,
        top: 112,
        bottom: 136,
        width: 40,
        height: 24,
      }),
      dispatchEvent: (event: FakeMouseEvent) => {
        events.push({
          type: event.type,
          clientX: event.init.clientX,
          clientY: event.init.clientY,
        });
      },
    };
    const script = __browserPluginInAppAdapterTest.coordinateClickScript(50, 108);
    const result = Function(
      "document",
      "window",
      "Element",
      "MouseEvent",
      `return ${script};`,
    )(
      {
        elementFromPoint: () => null,
        querySelectorAll: () => [button],
      },
      {
        getComputedStyle: () => ({
          display: "block",
          pointerEvents: "auto",
          visibility: "visible",
        }),
      },
      FakeElement,
      FakeMouseEvent,
    );

    expect(result).toEqual({ ok: true });
    expect(events.map((event) => event.type)).toEqual(["mousedown", "mouseup", "click"]);
    expect(events.every((event) => event.clientX === 50 && event.clientY === 108)).toBe(true);
  });

  it("runs locator inspection and actions through the tab webContents", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;

    win.webContents.scriptResults.push(2);
    await expect(adapter.locatorCount?.(tab.id, {
      kind: "role",
      role: "button",
      name: "Submit",
      exact: true,
    })).resolves.toBe(2);

    win.webContents.scriptResults.push(1);
    await expect(adapter.locatorCount?.(tab.id, {
      kind: "frame",
      frame: { kind: "css", selector: "iframe" },
      locator: { kind: "testId", value: "frame-button" },
    })).resolves.toBe(1);

    win.webContents.scriptResults.push("Submit");
    await expect(adapter.locatorInnerText?.(tab.id, {
      kind: "text",
      value: "Submit",
      exact: true,
    })).resolves.toBe("Submit");

    win.webContents.scriptResults.push("ready");
    await expect(adapter.locatorAttribute?.(tab.id, {
      kind: "testId",
      value: "submit-button",
    }, "data-state")).resolves.toBe("ready");

    win.webContents.scriptResults.push({ x: 42, y: 84 });
    await expect(adapter.locatorClick?.(tab.id, {
      kind: "role",
      role: "button",
      name: "Submit",
      index: 1,
    })).resolves.toBeUndefined();
    await expect(adapter.locatorFill?.(tab.id, {
      kind: "label",
      value: "Name",
    }, "Ada")).resolves.toBeUndefined();
    await expect(adapter.locatorPress?.(tab.id, {
      kind: "text",
      value: "Submit",
    }, "Enter")).resolves.toBeUndefined();
    await expect(adapter.locatorSetChecked?.(tab.id, {
      kind: "label",
      value: "Subscribe",
    }, true)).resolves.toBeUndefined();
    await expect(adapter.locatorSelectOption?.(tab.id, {
      kind: "label",
      value: "Mode",
    }, "auto")).resolves.toBeUndefined();

    const scripts = win.webContents.scripts.join("\n");
    expect(scripts).toContain("__backchatLocator");
    expect(scripts).toContain("resolveBackchatLocator");
    expect(scripts).toContain("\"index\":1");
    expect(scripts).toContain("Locator matched");
    expect(scripts).toContain("submit-button");
    expect(scripts).toContain("contentDocument");
    expect(scripts).toContain("frame-button");
    expect(scripts).toContain("data-state");
    expect(scripts).toContain("Enter");
    expect(scripts).toContain("checked");
    expect(scripts).toContain("auto");
    expect(win.webContents.inputEvents).toEqual([
      { type: "mouseMove", x: 42, y: 84 },
      { type: "mouseDown", x: 42, y: 84, button: "left", clickCount: 1 },
      { type: "mouseUp", x: 42, y: 84, button: "left", clickCount: 1 },
    ]);
  });

  it("clicks locator targets through browser input events", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;

    win.webContents.scriptResults.push({ x: 128.4, y: 72.5 });
    await expect(adapter.locatorClick?.(tab.id, {
      kind: "testId",
      value: "trusted-locator",
    })).resolves.toBeUndefined();

    expect(win.webContents.scripts.join("\n")).toContain("getBoundingClientRect");
    expect(win.webContents.inputEvents).toEqual([
      { type: "mouseMove", x: 128, y: 73 },
      { type: "mouseDown", x: 128, y: 73, button: "left", clickCount: 1 },
      { type: "mouseUp", x: 128, y: 73, button: "left", clickCount: 1 },
    ]);
  });

  it("temporarily shows hidden tabs for locator input clicks and restores visibility", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;

    win.webContents.scriptResults.push({ x: 24, y: 48 });
    await expect(adapter.locatorClick?.(tab.id, {
      kind: "testId",
      value: "trusted-locator",
    })).resolves.toBeUndefined();

    expect(win.showCalls).toBe(1);
    expect(win.hideCalls).toBe(1);
    expect(win.visible).toBe(false);
  });

  it("runs frame locators inside Electron child frames when iframe DOM is cross-origin", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;
    const childFrame = new FakeWebFrame();
    win.webContents.mainFrame.frames.push(childFrame);

    win.webContents.scriptResults.push(new Error("Frame locator target is not accessible"));
    win.webContents.scriptResults.push(0);
    childFrame.scriptResults.push(1);

    await expect(adapter.locatorCount?.(tab.id, {
      kind: "frame",
      frame: { kind: "css", selector: "iframe.remote" },
      locator: { kind: "testId", value: "frame-button" },
    })).resolves.toBe(1);

    expect(win.webContents.scripts[1]).toContain("iframe.remote");
    expect(win.webContents.scripts[1]).toContain("iframe, frame");
    expect(childFrame.scripts.join("\n")).toContain("frame-button");
  });

  it("collects a page asset inventory from document resource elements", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;
    win.webContents.scriptResults.push([
      { url: "http://127.0.0.1:5173/app.js", type: "script", tagName: "script" },
      { url: "http://127.0.0.1:5173/logo.png", type: "image", tagName: "img" },
    ]);

    await expect(adapter.pageAssets?.(tab.id)).resolves.toEqual([
      { url: "http://127.0.0.1:5173/app.js", type: "script", tagName: "script" },
      { url: "http://127.0.0.1:5173/logo.png", type: "image", tagName: "img" },
    ]);
    expect(win.webContents.scripts.join("\n")).toContain("querySelectorAll");
  });

  it("captures and resolves JavaScript dialogs without hanging the page", async () => {
    const fake = createFakeElectron();
    const adapter = createElectronInAppBrowserAdapter({
      createWindow: fake.createWindow,
    });
    const tab = await adapter.createTab();
    const win = fake.windows[0]!;
    let accepted: unknown[] | null = null;

    win.webContents.emit(
      "javascript-dialog-opening",
      { preventDefault() {} },
      {
        type: "confirm",
        message: "Proceed?",
        defaultPromptText: "",
      },
      (...args: unknown[]) => {
        accepted = args;
      },
    );

    await expect(adapter.getDialog?.(tab.id)).resolves.toEqual({
      type: "confirm",
      message: "Proceed?",
    });
    await adapter.acceptDialog?.(tab.id);
    expect(accepted).toEqual([true]);
    await expect(adapter.getDialog?.(tab.id)).resolves.toBeNull();
  });
});

function createFakeElectron() {
  const windows: FakeWindow[] = [];
  return {
    windows,
    createWindow: (options: unknown) => {
      const win = new FakeWindow(options);
      windows.push(win);
      return win;
    },
  };
}

class FakeWindow {
  readonly webContents = new FakeWebContents();
  bounds = { width: 1280, height: 720 };
  closed = false;
  visible = false;
  showCalls = 0;
  hideCalls = 0;
  setSizeCalls: Array<{ width: number; height: number }> = [];
  capturePageSizes: Array<{ width: number; height: number }> = [];
  nextCapturedImage: FakeCapturedImage | null = null;
  history = ["about:blank"];
  historyIndex = 0;
  reloadCalls = 0;
  attachCalls: Array<{
    hostWindow: unknown;
    bounds: { x: number; y: number; width: number; height: number };
    visible: boolean;
  }> = [];
  detachCalls = 0;

  constructor(readonly options: unknown) {
    if (isWindowOptions(options)) {
      this.bounds = { width: options.width, height: options.height };
    }
  }

  async loadURL(url: string) {
    this.webContents.url = url;
    this.webContents.title = url === "about:blank" ? "about:blank" : "Probe";
    this.history = [...this.history.slice(0, this.historyIndex + 1), url];
    this.historyIndex = this.history.length - 1;
  }

  reload() {
    this.reloadCalls += 1;
  }

  goBack() {
    this.historyIndex = Math.max(0, this.historyIndex - 1);
    const url = this.history[this.historyIndex] ?? "about:blank";
    this.webContents.url = url;
    this.webContents.title = url === "about:blank" ? "about:blank" : "Probe";
  }

  goForward() {
    this.historyIndex = Math.min(this.history.length - 1, this.historyIndex + 1);
    const url = this.history[this.historyIndex] ?? "about:blank";
    this.webContents.url = url;
    this.webContents.title = url === "about:blank" ? "about:blank" : "Probe";
  }

  async capturePage() {
    this.capturePageSizes.push(this.bounds);
    return this.nextCapturedImage ?? new FakeCapturedImage(this.bounds);
  }

  setSize(width: number, height: number) {
    this.bounds = { width, height };
    this.setSizeCalls.push({ width, height });
  }

  getContentSize() {
    return [this.bounds.width, this.bounds.height] as [number, number];
  }

  show() {
    this.showCalls += 1;
    this.visible = true;
  }

  hide() {
    this.hideCalls += 1;
    this.visible = false;
  }

  isVisible() {
    return this.visible;
  }

  close() {
    this.closed = true;
  }

  isDestroyed() {
    return this.closed;
  }

  attachToHost(
    hostWindow: unknown,
    bounds: { x: number; y: number; width: number; height: number },
    visible: boolean,
  ) {
    this.attachCalls.push({ hostWindow, bounds, visible });
  }

  detachFromHost() {
    this.detachCalls += 1;
  }
}

function isWindowOptions(value: unknown): value is { width: number; height: number } {
  return !!value &&
    typeof value === "object" &&
    typeof (value as { width?: unknown }).width === "number" &&
    typeof (value as { height?: unknown }).height === "number";
}

class FakeCapturedImage {
  resizeCalls: Array<{ width?: number; height?: number; quality?: "good" | "better" | "best" }> = [];

  constructor(readonly size: { width: number; height: number }) {}

  getSize() {
    return this.size;
  }

  resize(options: { width?: number; height?: number; quality?: "good" | "better" | "best" }) {
    this.resizeCalls.push(options);
    return new FakeCapturedImage({
      width: options.width ?? this.size.width,
      height: options.height ?? this.size.height,
    });
  }

  toJPEG() {
    return Uint8Array.from([0xff, 0xd8, 0xff]);
  }
}

class FakeContentView {
  children: unknown[] = [];

  addChildView(view: unknown) {
    this.children.push(view);
  }

  removeChildView(view: unknown) {
    this.children = this.children.filter((child) => child !== view);
  }
}

class FakeWebContents extends EventEmitter {
  url = "about:blank";
  title = "about:blank";
  mainFrame = new FakeWebFrame();
  scripts: string[] = [];
  scriptResults: unknown[] = [];
  inputEvents: unknown[] = [];

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.title;
  }

  setWindowOpenHandler() {
    return undefined;
  }

  async executeJavaScript(script: string) {
    this.scripts.push(script);
    const result = this.scriptResults.length > 0 ? this.scriptResults.shift() : undefined;
    if (result instanceof Error) throw result;
    return result;
  }

  sendInputEvent(event: unknown) {
    this.inputEvents.push(event);
  }
}

class FakeWebFrame {
  frames: FakeWebFrame[] = [];
  detached = false;
  scripts: string[] = [];
  scriptResults: unknown[] = [];

  isDestroyed() {
    return false;
  }

  async executeJavaScript(script: string) {
    this.scripts.push(script);
    const result = this.scriptResults.length > 0 ? this.scriptResults.shift() : undefined;
    if (result instanceof Error) throw result;
    return result;
  }
}
