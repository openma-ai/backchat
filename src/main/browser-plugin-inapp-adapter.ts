import type {
  BrowserBackendAdapter,
  BrowserDescriptor,
  BrowserDialogInfo,
  BrowserDevLogEntry,
  BrowserLocatorDescriptor,
  BrowserPageAssetEntry,
  BrowserScreenshotOptions,
  BrowserTabInfo,
  BrowserViewBounds,
  BrowserViewportSize,
} from "./browser-plugin-service.js";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

export interface ElectronInAppBrowserAdapterOptions {
  id?: string;
  name?: string;
  partition?: string;
  createWindow?: (
    options: ElectronBrowserWindowOptions,
  ) => ElectronBrowserWindowLike | Promise<ElectronBrowserWindowLike>;
  now?: () => string;
}

export interface ElectronBrowserWindowOptions {
  show: boolean;
  width: number;
  height: number;
  webPreferences: {
    contextIsolation: boolean;
    nodeIntegration: boolean;
    sandbox: boolean;
    partition?: string;
  };
}

export interface ElectronBrowserWindowLike {
  webContents: ElectronWebContentsLike;
  loadURL(url: string): Promise<void>;
  reload?(): void;
  goBack?(): void;
  goForward?(): void;
  capturePage(
    rect?: { x: number; y: number; width: number; height: number },
    opts?: { stayHidden?: boolean },
  ): Promise<ElectronNativeImageLike>;
  setSize(width: number, height: number): void;
  getContentSize?(): [number, number];
  show(): void;
  hide(): void;
  isVisible(): boolean;
  close(): void;
  isDestroyed(): boolean;
  attachToHost?(hostWindow: unknown, bounds: BrowserViewBounds, visible: boolean): void;
  detachFromHost?(): void;
}

export interface ElectronWebContentsLike {
  readonly mainFrame?: ElectronWebFrameMainLike;
  loadURL?(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  capturePage?(
    rect?: { x: number; y: number; width: number; height: number },
    opts?: { stayHidden?: boolean },
  ): Promise<ElectronNativeImageLike>;
  close?(): void;
  isDestroyed?(): boolean;
  executeJavaScript?(code: string, userGesture?: boolean): Promise<unknown>;
  sendInputEvent?(event: {
    type: string;
    keyCode?: string;
    text?: string;
    x?: number;
    y?: number;
    button?: "left" | "middle" | "right";
    clickCount?: number;
  }): void;
  reload?(): void;
  goBack?(): void;
  goForward?(): void;
  setWindowOpenHandler?(
    handler: (details: { url: string }) => { action: "allow" | "deny" },
  ): void;
  on(
    event: "console-message" | "javascript-dialog-opening",
    listener: (...args: unknown[]) => void,
  ): unknown;
}

interface ElectronNativeImageLike {
  toJPEG(quality: number): Uint8Array | Buffer;
  toPNG?(): Uint8Array | Buffer;
  getSize?(): { width: number; height: number };
  resize?(options: {
    width?: number;
    height?: number;
    quality?: "good" | "better" | "best";
  }): ElectronNativeImageLike;
}

export interface ElectronWebFrameMainLike {
  readonly frames: ElectronWebFrameMainLike[];
  readonly detached?: boolean;
  isDestroyed?(): boolean;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

interface TabRecord {
  id: string;
  win: ElectronBrowserWindowLike;
  logs: BrowserDevLogEntry[];
  dialog: BrowserDialogRecord | null;
}

interface BrowserDialogRecord extends BrowserDialogInfo {
  respond?: (accepted: boolean, promptText?: string) => void;
}

export function createElectronInAppBrowserAdapter(
  options: ElectronInAppBrowserAdapterOptions = {},
): BrowserBackendAdapter {
  let seq = 0;
  const tabs = new Map<string, TabRecord>();
  const createWindow = options.createWindow ?? defaultCreateWindow;
  const now = options.now ?? (() => new Date().toISOString());
  let viewportSize: BrowserViewportSize = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const descriptor: BrowserDescriptor = {
    id: options.id ?? "backchat-iab",
    type: "iab",
    name: options.name ?? "Backchat In-app Browser",
    capabilities: {
      browser: [
        {
          id: "visibility",
          description: "Show or hide Backchat's owned in-app browser surface.",
        },
        {
          id: "viewport",
          description: "Resize Backchat's owned in-app browser viewport.",
        },
        {
          id: "viewAttach",
          description: "Attach the owned browser tab to Backchat's right rail.",
        },
      ],
      tab: [
        {
          id: "history",
          description: "Reload and move backward or forward in tab history.",
        },
        {
          id: "pageAssets",
          description: "Inventory page assets observed by the browser backend.",
        },
        {
          id: "domSnapshot",
          description: "Capture readable text from the visible DOM.",
        },
        {
          id: "evaluate",
          description: "Evaluate JavaScript in the page context.",
        },
        {
          id: "input",
          description: "Click, type, and send keypresses to the page.",
        },
        {
          id: "cua",
          description: "Click viewport coordinates using browser input events.",
        },
        {
          id: "domCua",
          description: "Inspect compact interactable DOM and click by node id.",
        },
        {
          id: "dialogs",
          description: "Inspect and resolve JavaScript dialogs.",
        },
        {
          id: "locators",
          description: "Find elements by CSS, text, label, role, or test id.",
        },
      ],
    },
  };

  const getRecord = (tabId: string): TabRecord => {
    const record = tabs.get(tabId);
    if (!record || record.win.isDestroyed()) {
      throw new Error(`tabs.get could not find tab id "${tabId}"`);
    }
    return record;
  };

  return {
    descriptor,

    async listTabs() {
      return [...tabs.values()]
        .filter((record) => !record.win.isDestroyed())
        .map((record) => toTabInfo(record.id, record.win));
    },

    async userTabs() {
      return [];
    },

    async createTab() {
      const win = await createWindow({
        show: false,
        width: viewportSize.width,
        height: viewportSize.height,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          ...(options.partition ? { partition: options.partition } : {}),
        },
      });
      win.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
      const id = String(++seq);
      const record: TabRecord = { id, win, logs: [], dialog: null };
      attachConsoleLog(record, now);
      attachJavaScriptDialog(record);
      tabs.set(id, record);
      await win.loadURL("about:blank");
      return toTabInfo(id, win);
    },

    async getTab(tabId) {
      return toTabInfo(tabId, getRecord(tabId).win);
    },

    async closeTab(tabId) {
      const record = getRecord(tabId);
      record.win.detachFromHost?.();
      record.win.close();
      tabs.delete(tabId);
    },

    async navigate(tabId, url) {
      const record = getRecord(tabId);
      await record.win.loadURL(url);
      return toTabInfo(tabId, record.win);
    },

    async reload(tabId) {
      const record = getRecord(tabId);
      if (record.win.reload) record.win.reload();
      else if (record.win.webContents.reload) record.win.webContents.reload();
      else throw new Error("Browser webContents does not support reload");
      return toTabInfo(tabId, record.win);
    },

    async back(tabId) {
      const record = getRecord(tabId);
      if (record.win.goBack) record.win.goBack();
      else if (record.win.webContents.goBack) record.win.webContents.goBack();
      else throw new Error("Browser webContents does not support back");
      return toTabInfo(tabId, record.win);
    },

    async forward(tabId) {
      const record = getRecord(tabId);
      if (record.win.goForward) record.win.goForward();
      else if (record.win.webContents.goForward) record.win.webContents.goForward();
      else throw new Error("Browser webContents does not support forward");
      return toTabInfo(tabId, record.win);
    },

    async screenshot(tabId, screenshotOptions?: BrowserScreenshotOptions) {
      const record = getRecord(tabId);
      return captureTabScreenshot(record, screenshotOptions);
    },

    async devLogs(tabId) {
      return [...getRecord(tabId).logs];
    },

    async pageAssets(tabId) {
      return normalizePageAssets(
        await executeInTab(getRecord(tabId), PAGE_ASSETS_SCRIPT),
      );
    },

    async domSnapshot(tabId) {
      return String(await executeInTab(getRecord(tabId), DOM_SNAPSHOT_SCRIPT));
    },

    async evaluate(tabId, expression) {
      return executeInTab(
        getRecord(tabId),
        `(() => {
          const __backchatExpression = ${JSON.stringify(expression)};
          return (0, eval)(__backchatExpression);
        })()`,
      );
    },

    async click(tabId, selector) {
      await executeInTab(
        getRecord(tabId),
        elementActionScript(selector, `
          element.scrollIntoView({ block: "center", inline: "center" });
          element.click();
        `),
        true,
      );
    },

    async type(tabId, selector, text) {
      await executeInTab(
        getRecord(tabId),
        elementActionScript(selector, `
          element.focus();
          const text = ${JSON.stringify(text)};
          if ("value" in element) {
            element.value = text;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            element.textContent = text;
            element.dispatchEvent(new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: text
            }));
          }
        `),
        true,
      );
    },

    async press(tabId, key) {
      const webContents = getRecord(tabId).win.webContents;
      if (!webContents.sendInputEvent) {
        throw new Error("Browser webContents does not support input events");
      }
      webContents.sendInputEvent({ type: "keyDown", keyCode: key });
      webContents.sendInputEvent({ type: "keyUp", keyCode: key });
    },

    async coordinateClick(tabId, x, y) {
      const record = getRecord(tabId);
      if (!record.win.isVisible()) {
        const result = await executeInTab(record, coordinateClickScript(x, y), true);
        if (!isRecord(result) || result.ok !== true) {
          const error = isRecord(result) && typeof result.error === "string"
            ? result.error
            : "coordinate click script failed";
          throw new Error(error);
        }
        return;
      }
      const webContents = record.win.webContents;
      if (!webContents.sendInputEvent) {
        throw new Error("Browser webContents does not support input events");
      }
      webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    },

    async domCuaSnapshot(tabId) {
      return String(await executeInTab(getRecord(tabId), DOM_CUA_SNAPSHOT_SCRIPT));
    },

    async domCuaClick(tabId, nodeId) {
      await executeInTab(
        getRecord(tabId),
        domCuaActionScript(nodeId, `
          element.scrollIntoView({ block: "center", inline: "center" });
          element.click();
          return null;
        `),
        true,
      );
    },

    async locatorCount(tabId, locator) {
      const result = await executeLocatorOperation(getRecord(tabId), locator, "count");
      if (typeof result !== "number" || !Number.isFinite(result)) {
        throw new Error("Browser locator count returned a non-number result");
      }
      return result;
    },

    async locatorClick(tabId, locator) {
      const record = getRecord(tabId);
      if (locator.kind !== "frame" && record.win.webContents.sendInputEvent) {
        await clickLocatorWithInputEvents(record, locator);
        return;
      }
      await executeLocatorOperation(record, locator, "click", [], true);
    },

    async locatorFill(tabId, locator, text) {
      await executeLocatorOperation(
        getRecord(tabId),
        locator,
        "fill",
        [text],
        true,
      );
    },

    async locatorPress(tabId, locator, key) {
      await executeLocatorOperation(
        getRecord(tabId),
        locator,
        "press",
        [key],
        true,
      );
    },

    async locatorSetChecked(tabId, locator, checked) {
      await executeLocatorOperation(
        getRecord(tabId),
        locator,
        "setChecked",
        [checked],
        true,
      );
    },

    async locatorSelectOption(tabId, locator, value) {
      await executeLocatorOperation(
        getRecord(tabId),
        locator,
        "selectOption",
        [value],
        true,
      );
    },

    async locatorInnerText(tabId, locator) {
      return String(await executeLocatorOperation(
        getRecord(tabId),
        locator,
        "innerText",
      ));
    },

    async locatorAttribute(tabId, locator, name) {
      const result = await executeLocatorOperation(
        getRecord(tabId),
        locator,
        "attribute",
        [name],
      );
      return result === null || result === undefined ? null : String(result);
    },

    async getDialog(tabId) {
      const dialog = getRecord(tabId).dialog;
      if (!dialog) return null;
      const { respond: _respond, ...publicDialog } = dialog;
      return publicDialog;
    },

    async acceptDialog(tabId, promptText) {
      const record = getRecord(tabId);
      if (!record.dialog) throw new Error("No JavaScript dialog is active");
      const dialog = record.dialog;
      record.dialog = null;
      if (promptText === undefined) dialog.respond?.(true);
      else dialog.respond?.(true, promptText);
    },

    async dismissDialog(tabId) {
      const record = getRecord(tabId);
      if (!record.dialog) throw new Error("No JavaScript dialog is active");
      const dialog = record.dialog;
      record.dialog = null;
      dialog.respond?.(false);
    },

    async setViewport(size: BrowserViewportSize) {
      viewportSize = { width: size.width, height: size.height };
      for (const record of tabs.values()) {
        if (!record.win.isDestroyed()) record.win.setSize(size.width, size.height);
      }
    },

    async resetViewport() {
      viewportSize = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
      for (const record of tabs.values()) {
        if (!record.win.isDestroyed()) record.win.setSize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
      }
    },

    async setVisibility(visible: boolean) {
      for (const record of tabs.values()) {
        if (record.win.isDestroyed()) continue;
        if (visible) record.win.show();
        else record.win.hide();
      }
    },

    async getVisibility() {
      return [...tabs.values()].some((record) =>
        !record.win.isDestroyed() && record.win.isVisible(),
      );
    },

    async attachView(tabId, target) {
      const record = getRecord(tabId);
      if (!record.win.attachToHost) {
        throw new Error("In-app browser tab does not support attachable views");
      }
      record.win.attachToHost(target.hostWindow, target.bounds, target.visible);
    },

    async detachView(tabId) {
      const record = getRecord(tabId);
      record.win.detachFromHost?.();
    },
  };
}

async function defaultCreateWindow(
  options: ElectronBrowserWindowOptions,
): Promise<ElectronBrowserWindowLike> {
  const { BrowserWindow, WebContentsView } = await import("electron");
  const parkingWindow = new BrowserWindow({
    show: false,
    x: -10000,
    y: -10000,
    width: options.width,
    height: options.height,
    focusable: false,
    frame: false,
    skipTaskbar: true,
  });
  return new WebContentsViewHost(
    new WebContentsView({ webPreferences: options.webPreferences }),
    {
      width: options.width,
      height: options.height,
      visible: options.show,
    },
    parkingWindow,
  );
}

interface HostContentViewLike {
  addChildView(view: unknown): void;
  removeChildView(view: unknown): void;
}

interface HostWindowLike {
  contentView: HostContentViewLike;
}

interface ParkingWindowLike extends HostWindowLike {
  center?(): void;
  close(): void;
  hide(): void;
  isDestroyed?(): boolean;
  isVisible?(): boolean;
  show?(): void;
  showInactive?(): void;
  setSize?(width: number, height: number): void;
}

interface WebContentsViewLike {
  webContents: ElectronWebContentsLike;
  setBounds(bounds: BrowserViewBounds): void;
  setVisible(visible: boolean): void;
}

class WebContentsViewHost implements ElectronBrowserWindowLike {
  readonly webContents: ElectronWebContentsLike;
  #bounds: BrowserViewBounds;
  #visible: boolean;
  #destroyed = false;
  #hostWindow: HostWindowLike | null = null;
  #parked = false;

  constructor(
    readonly view: WebContentsViewLike,
    options: { width: number; height: number; visible: boolean },
    readonly parkingWindow: ParkingWindowLike | null = null,
  ) {
    this.webContents = view.webContents;
    this.#bounds = { x: 0, y: 0, width: options.width, height: options.height };
    this.#visible = options.visible;
    this.view.setBounds(this.#bounds);
    this.view.setVisible(options.visible);
    this.park();
  }

  async loadURL(url: string): Promise<void> {
    if (!this.webContents.loadURL) {
      throw new Error("Browser webContents does not support loadURL");
    }
    await this.webContents.loadURL(url);
  }

  reload(): void {
    this.webContents.reload?.();
  }

  goBack(): void {
    this.webContents.goBack?.();
  }

  goForward(): void {
    this.webContents.goForward?.();
  }

  async capturePage(
    rect?: { x: number; y: number; width: number; height: number },
    opts?: { stayHidden?: boolean },
  ): Promise<ElectronNativeImageLike> {
    if (!this.webContents.capturePage) {
      throw new Error("Browser webContents does not support capturePage");
    }
    try {
      const image = await this.webContents.capturePage(rect, opts);
      if (!isEmptyCapturedImage(image)) return image;
      if (!this.#parked || !this.parkingWindow) return image;
    } catch (error) {
      if (!this.#parked || !this.parkingWindow) throw error;
    }

    return this.captureFromParkingWindow(rect);
  }

  setSize(width: number, height: number): void {
    this.#bounds = { ...this.#bounds, width, height };
    this.view.setBounds(this.#bounds);
    this.parkingWindow?.setSize?.(width, height);
  }

  getContentSize(): [number, number] {
    return [this.#bounds.width, this.#bounds.height];
  }

  show(): void {
    this.#visible = true;
    this.view.setVisible(true);
    if (this.#parked && this.parkingWindow && this.parkingWindow.isDestroyed?.() !== true) {
      this.parkingWindow.center?.();
      this.parkingWindow.show?.();
    }
  }

  hide(): void {
    this.#visible = false;
    this.view.setVisible(false);
    if (this.#parked && this.parkingWindow && this.parkingWindow.isDestroyed?.() !== true) {
      this.parkingWindow.hide();
    }
  }

  isVisible(): boolean {
    if (!this.#visible) return false;
    if (!this.#parked) return true;
    return this.parkingWindow?.isVisible?.() === true;
  }

  close(): void {
    this.detachFromHost();
    this.unpark();
    this.webContents.close?.();
    if (this.parkingWindow && this.parkingWindow.isDestroyed?.() !== true) {
      this.parkingWindow.close();
    }
    this.#destroyed = true;
  }

  isDestroyed(): boolean {
    return this.#destroyed || this.webContents.isDestroyed?.() === true;
  }

  attachToHost(hostWindow: unknown, bounds: BrowserViewBounds, visible: boolean): void {
    const host = readHostWindow(hostWindow);
    this.unpark();
    if (this.#hostWindow && this.#hostWindow !== host) {
      this.#hostWindow.contentView.removeChildView(this.view);
    }
    this.#hostWindow = host;
    host.contentView.addChildView(this.view);
    this.#bounds = bounds;
    this.view.setBounds(bounds);
    this.#visible = visible;
    this.view.setVisible(visible);
  }

  detachFromHost(): void {
    if (this.#hostWindow) {
      this.#hostWindow.contentView.removeChildView(this.view);
      this.#hostWindow = null;
    }
    this.view.setVisible(false);
    this.park();
  }

  private park(): void {
    if (!this.parkingWindow || this.#parked || this.parkingWindow.isDestroyed?.() === true) {
      return;
    }
    this.parkingWindow.contentView.addChildView(this.view);
    this.view.setBounds(this.#bounds);
    this.view.setVisible(this.#visible);
    this.#parked = true;
  }

  private unpark(): void {
    if (!this.parkingWindow || !this.#parked || this.parkingWindow.isDestroyed?.() === true) {
      return;
    }
    this.parkingWindow.hide();
    this.parkingWindow.contentView.removeChildView(this.view);
    this.#parked = false;
  }

  private async captureFromParkingWindow(
    rect?: { x: number; y: number; width: number; height: number },
  ): Promise<ElectronNativeImageLike> {
    if (!this.parkingWindow || !this.webContents.capturePage) {
      throw new Error("Browser webContents does not support capturePage");
    }
    const wasVisible = this.parkingWindow.isVisible?.() === true;
    const wasViewVisible = this.#visible;
    this.view.setVisible(true);
    if (this.parkingWindow.showInactive) this.parkingWindow.showInactive();
    else this.parkingWindow.show?.();
    try {
      await delay(80);
      return this.webContents.capturePage(rect, { stayHidden: false });
    } finally {
      this.view.setVisible(wasViewVisible);
      if (!wasVisible) this.parkingWindow.hide();
    }
  }
}

export const __browserPluginInAppAdapterTest = {
  WebContentsViewHost,
  coordinateClickScript,
};

function readHostWindow(hostWindow: unknown): HostWindowLike {
  if (
    !hostWindow ||
    typeof hostWindow !== "object" ||
    !("contentView" in hostWindow) ||
    !hostWindow.contentView ||
    typeof hostWindow.contentView !== "object" ||
    typeof (hostWindow.contentView as HostContentViewLike).addChildView !== "function" ||
    typeof (hostWindow.contentView as HostContentViewLike).removeChildView !== "function"
  ) {
    throw new Error("In-app browser attach requires a host BrowserWindow");
  }
  return hostWindow as HostWindowLike;
}

function toTabInfo(id: string, win: ElectronBrowserWindowLike): BrowserTabInfo {
  return {
    id,
    title: win.webContents.getTitle() || undefined,
    url: win.webContents.getURL() || undefined,
  };
}

function attachConsoleLog(record: TabRecord, now: () => string): void {
  record.win.webContents.on("console-message", (...args: unknown[]) => {
    const details = args[0] as {
      level?: string;
      message?: string;
      sourceId?: string;
    } | null;
    const level = normalizeLogLevel(details?.level ?? (typeof args[1] === "number" ? args[1] : undefined));
    const message =
      typeof details?.message === "string"
        ? details.message
        : typeof args[2] === "string"
          ? args[2]
          : "";
    record.logs.push({
      level,
      message,
      timestamp: now(),
      ...(details?.sourceId ? { url: details.sourceId } : typeof args[4] === "string" ? { url: args[4] } : {}),
    });
  });
}

function normalizeLogLevel(level: string | number | undefined): BrowserDevLogEntry["level"] {
  if (level === "warning" || level === 2) return "warn";
  if (level === "error" || level === 3) return "error";
  if (level === "debug" || level === 0) return "debug";
  if (level === "info" || level === 1) return "info";
  if (level === "log") return "log";
  return "log";
}

const DOM_SNAPSHOT_SCRIPT = `(() => {
  const body = document.body;
  if (!body) return "";
  return body.innerText || body.textContent || "";
})()`;

const PAGE_ASSETS_SCRIPT = `(() => {
  const assets = [];
  const push = (element, rawUrl, type, extra = {}) => {
    if (!rawUrl) return;
    try {
      assets.push({
        url: new URL(rawUrl, document.baseURI).href,
        type,
        tagName: element.tagName.toLowerCase(),
        ...extra,
      });
    } catch {
      // Ignore malformed resource URLs.
    }
  };
  for (const script of document.querySelectorAll("script[src]")) {
    push(script, script.getAttribute("src"), "script");
  }
  for (const link of document.querySelectorAll("link[href]")) {
    const rel = link.getAttribute("rel") || "";
    const as = link.getAttribute("as") || "";
    const type = rel.includes("stylesheet")
      ? "stylesheet"
      : as === "font"
        ? "font"
        : "other";
    push(link, link.getAttribute("href"), type, { rel });
  }
  for (const img of document.querySelectorAll("img[src], source[src], video[src], audio[src]")) {
    const tagName = img.tagName.toLowerCase();
    const type = tagName === "img" || tagName === "source" ? "image" : "media";
    push(img, img.getAttribute("src"), type);
  }
  return assets;
})()`;

async function executeInTab(
  record: TabRecord,
  script: string,
  userGesture = false,
): Promise<unknown> {
  const executeJavaScript = record.win.webContents.executeJavaScript;
  if (!executeJavaScript) {
    throw new Error("Browser webContents does not support JavaScript execution");
  }
  return executeJavaScript.call(record.win.webContents, script, userGesture);
}

async function captureTabScreenshot(
  record: TabRecord,
  options?: BrowserScreenshotOptions,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (options?.fullPage === true && !options.clip) {
    return captureFullPageScreenshot(record);
  }
  return captureViewportScreenshot(record, options?.clip);
}

async function captureFullPageScreenshot(record: TabRecord): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const originalSize = windowContentSize(record.win);
  const wasVisible = record.win.isVisible();
  if (!wasVisible) {
    record.win.show();
    await delay(200);
  }
  let page: ReturnType<typeof readFullPageMetrics> | null = null;
  try {
    page = readFullPageMetrics(
      await executeInTab(record, FULL_PAGE_METRICS_SCRIPT),
    );
    record.win.setSize(page.width, page.height);
    await delay(120);
    return await captureViewportScreenshot(record, undefined, {
      width: page.width,
      height: page.height,
    });
  } finally {
    record.win.setSize(originalSize.width, originalSize.height);
    if (page) {
      await executeInTab(record, restoreScrollScript(page.scrollX, page.scrollY)).catch(() => undefined);
    }
    if (!wasVisible) record.win.hide();
  }
}

async function captureViewportScreenshot(
  record: TabRecord,
  clip?: { x: number; y: number; width: number; height: number },
  targetSizeOverride?: { width: number; height: number },
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const targetSize = targetSizeOverride ?? screenshotTargetSize(record.win, clip);
  let image = await record.win.capturePage(clip, { stayHidden: true });
  let screenshot = imageToScreenshot(image, targetSize);
  if (screenshot.bytes.length > 0 || record.win.isVisible()) return screenshot;

  record.win.show();
  try {
    await delay(80);
    image = await record.win.capturePage(clip, { stayHidden: false });
    screenshot = imageToScreenshot(image, targetSize);
    return screenshot;
  } finally {
    record.win.hide();
  }
}

const FULL_PAGE_METRICS_SCRIPT = `(() => {
  const documentElement = document.documentElement;
  const body = document.body;
  const viewportWidth = Math.max(
    documentElement?.clientWidth || 0,
    body?.clientWidth || 0
  );
  const width = Math.ceil(viewportWidth > 0
    ? viewportWidth
    : Math.max(
      documentElement?.scrollWidth || 0,
      documentElement?.offsetWidth || 0,
      body?.scrollWidth || 0,
      body?.offsetWidth || 0,
      window.innerWidth || 0,
      1
    )
  );
  const height = Math.ceil(Math.max(
    documentElement?.scrollHeight || 0,
    documentElement?.offsetHeight || 0,
    documentElement?.clientHeight || 0,
    body?.scrollHeight || 0,
    body?.offsetHeight || 0,
    window.innerHeight || 0,
    1
  ));
  const scrollX = window.scrollX || 0;
  const scrollY = window.scrollY || 0;
  window.scrollTo(0, 0);
  return { width, height, scrollX, scrollY };
})()`;

function restoreScrollScript(x: number, y: number): string {
  return `(() => { window.scrollTo(${JSON.stringify(x)}, ${JSON.stringify(y)}); })()`;
}

function readFullPageMetrics(value: unknown): {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
} {
  if (!isRecord(value)) {
    throw new Error("Browser full-page screenshot did not return page metrics");
  }
  const width = readPositiveInteger(value.width);
  const height = readPositiveInteger(value.height);
  if (width === null || height === null) {
    throw new Error("Browser full-page screenshot requires positive page dimensions");
  }
  return {
    width,
    height,
    scrollX: readFiniteNumber(value.scrollX) ?? 0,
    scrollY: readFiniteNumber(value.scrollY) ?? 0,
  };
}

function windowContentSize(win: ElectronBrowserWindowLike): { width: number; height: number } {
  const size = win.getContentSize?.();
  if (!size) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  return {
    width: Math.max(1, Math.round(size[0])),
    height: Math.max(1, Math.round(size[1])),
  };
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function screenshotTargetSize(
  win: ElectronBrowserWindowLike,
  clip?: { x: number; y: number; width: number; height: number },
): { width: number; height: number } | null {
  if (clip) return { width: clip.width, height: clip.height };
  const size = win.getContentSize?.();
  if (!size) return null;
  const [width, height] = size;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function imageToScreenshot(
  image: ElectronNativeImageLike,
  targetSize: { width: number; height: number } | null = null,
): { bytes: Uint8Array; mimeType: string } {
  const normalizedImage = resizeCapturedImage(image, targetSize);
  const jpeg = toUint8Array(normalizedImage.toJPEG(85));
  if (jpeg.length > 0) {
    return { bytes: jpeg, mimeType: "image/jpeg" };
  }
  if (normalizedImage.toPNG) {
    const png = toUint8Array(normalizedImage.toPNG());
    if (png.length > 0) {
      return { bytes: png, mimeType: "image/png" };
    }
  }
  return { bytes: jpeg, mimeType: "image/jpeg" };
}

function resizeCapturedImage(
  image: ElectronNativeImageLike,
  targetSize: { width: number; height: number } | null,
): ElectronNativeImageLike {
  if (!targetSize || !image.getSize || !image.resize) return image;
  const current = image.getSize();
  if (current.width === targetSize.width && current.height === targetSize.height) {
    return image;
  }
  return image.resize({
    width: Math.round(targetSize.width),
    height: Math.round(targetSize.height),
    quality: "best",
  });
}

function isEmptyCapturedImage(image: ElectronNativeImageLike): boolean {
  return toUint8Array(image.toJPEG(1)).length === 0 &&
    (!image.toPNG || toUint8Array(image.toPNG()).length === 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function elementActionScript(selector: string, action: string): string {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const element = document.querySelector(selector);
    if (!element) throw new Error("No element matches selector: " + selector);
    ${action}
  })()`;
}

function coordinateClickScript(x: number, y: number): string {
  return `(() => {
    try {
      const x = ${JSON.stringify(x)};
      const y = ${JSON.stringify(y)};
      const isVisibleClickCandidate = (candidate) => {
        if (
          !candidate ||
          candidate.nodeType !== 1 ||
          typeof candidate.getBoundingClientRect !== "function"
        ) {
          return false;
        }
        const style = window.getComputedStyle(candidate);
        if (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") {
          return false;
        }
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const rectContainsPoint = (rect) =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      const distanceToRect = (rect) => {
        const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
        const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
        return Math.hypot(dx, dy);
      };
      const interactableRank = (candidate) => {
        const tag = candidate.tagName.toLowerCase();
        const role = candidate.getAttribute("role") || "";
        return tag === "button" ||
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          (tag === "a" && candidate.hasAttribute("href")) ||
          role === "button" ||
          role === "link" ||
          candidate.isContentEditable === true
          ? 0
          : 1;
      };
      const candidates = Array.from(document.querySelectorAll("*"))
        .filter(isVisibleClickCandidate);
      const containingElement = candidates.slice().reverse().find((candidate) =>
        rectContainsPoint(candidate.getBoundingClientRect())
      );
      const nearbyElement = candidates
        .map((candidate) => ({
          candidate,
          distance: distanceToRect(candidate.getBoundingClientRect()),
          rank: interactableRank(candidate),
        }))
        .filter((entry) => entry.distance <= 16)
        .sort((left, right) =>
          left.rank - right.rank || left.distance - right.distance
        )[0]?.candidate;
      const element = document.elementFromPoint(x, y) || Array.from(
        document.querySelectorAll("*"),
      ).reverse().find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return isVisibleClickCandidate(candidate) && rectContainsPoint(rect);
      }) || containingElement || nearbyElement;
      if (!element) {
        return { ok: false, error: "No element at coordinates: " + x + "," + y };
      }
      for (const type of ["mousedown", "mouseup", "click"]) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
        }));
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })()`;
}

const DOM_CUA_RUNTIME_SCRIPT = `
  const normalizeDomCuaText = (value) =>
    String(value ?? "").replace(/\\s+/g, " ").trim();
  const isDomCuaElement = (element) =>
    !!element && element.nodeType === 1;
  const isDomCuaVisible = (element) => {
    if (!isDomCuaElement(element)) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };
  const domCuaText = (element) =>
    normalizeDomCuaText(element.innerText || element.textContent || element.value || "");
  const domCuaLabel = (element) =>
    element.getAttribute("aria-label") ||
    element.getAttribute("placeholder") ||
    element.getAttribute("title") ||
    "";
  const domCuaTag = (element) => element.tagName.toLowerCase();
  const isDomCuaInteractable = (element) => {
    const tag = domCuaTag(element);
    const role = element.getAttribute("role") || "";
    return (
      tag === "button" ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      (tag === "a" && element.hasAttribute("href")) ||
      role === "button" ||
      role === "link" ||
      element.isContentEditable === true
    );
  };
  const domCuaElements = () =>
    Array.from(document.querySelectorAll("a[href], button, input, textarea, select, [role=button], [role=link], [contenteditable=true]"))
      .filter((element) => isDomCuaVisible(element) && isDomCuaInteractable(element));
  const escapeDomCuaAttr = (value) =>
    String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const escapeDomCuaText = (value) =>
    String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const domCuaMarkup = (element, index) => {
    const attrs = ["node_id=\\"" + String(index + 1) + "\\""];
    const label = domCuaLabel(element);
    if (label) attrs.push("aria-label=\\"" + escapeDomCuaAttr(label) + "\\"");
    if ("value" in element && element.value) {
      attrs.push("value=\\"" + escapeDomCuaAttr(element.value) + "\\"");
    }
    return "<" + domCuaTag(element) + " " + attrs.join(" ") + ">" +
      escapeDomCuaText(domCuaText(element)) +
      "</" + domCuaTag(element) + ">";
  };
  const domCuaElementByNodeId = (nodeId) => {
    const index = Number(nodeId) - 1;
    if (!Number.isInteger(index) || index < 0) {
      throw new Error("DOM CUA node_id must be a positive integer");
    }
    const element = domCuaElements()[index];
    if (!element) {
      throw new Error("No DOM CUA node matches node_id: " + String(nodeId));
    }
    return element;
  };
`;

const DOM_CUA_SNAPSHOT_SCRIPT = `(() => {
  ${DOM_CUA_RUNTIME_SCRIPT}
  return domCuaElements().map(domCuaMarkup).join("\\n");
})()`;

function domCuaActionScript(nodeId: string, action: string): string {
  return `(() => {
    const node_id = ${JSON.stringify(nodeId)};
    ${DOM_CUA_RUNTIME_SCRIPT}
    const element = domCuaElementByNodeId(node_id);
    ${action}
  })()`;
}

type LocatorOperation =
  | "count"
  | "click"
  | "fill"
  | "press"
  | "setChecked"
  | "selectOption"
  | "innerText"
  | "attribute";

async function executeLocatorOperation(
  record: TabRecord,
  locator: BrowserLocatorDescriptor,
  operation: LocatorOperation,
  operationArgs: unknown[] = [],
  userGesture = false,
): Promise<unknown> {
  const script = locatorOperationScript(locator, operation, operationArgs);
  if (locator.kind !== "frame") {
    return executeInTab(record, script, userGesture);
  }

  try {
    return await executeInTab(record, script, userGesture);
  } catch (error) {
    if (!isFrameLocatorAccessibilityError(error)) throw error;
    return executeFrameLocatorOperation(
      record,
      locator,
      operation,
      operationArgs,
      userGesture,
    );
  }
}

async function executeFrameLocatorOperation(
  record: TabRecord,
  locator: Extract<BrowserLocatorDescriptor, { kind: "frame" }>,
  operation: LocatorOperation,
  operationArgs: unknown[],
  userGesture: boolean,
): Promise<unknown> {
  const frameIndex = readFrameIndex(
    await executeInTab(record, frameIndexScript(locator.frame)),
  );
  const childFrame = childFrameAt(record.win.webContents.mainFrame, frameIndex);
  return executeLocatorOperationInFrame(
    childFrame,
    locator.locator,
    operation,
    operationArgs,
    userGesture,
  );
}

async function executeLocatorOperationInFrame(
  frame: ElectronWebFrameMainLike,
  locator: BrowserLocatorDescriptor,
  operation: LocatorOperation,
  operationArgs: unknown[],
  userGesture: boolean,
): Promise<unknown> {
  if (locator.kind === "frame") {
    const frameIndex = readFrameIndex(
      await frame.executeJavaScript(frameIndexScript(locator.frame), userGesture),
    );
    return executeLocatorOperationInFrame(
      childFrameAt(frame, frameIndex),
      locator.locator,
      operation,
      operationArgs,
      userGesture,
    );
  }
  return frame.executeJavaScript(
    locatorOperationScript(locator, operation, operationArgs),
    userGesture,
  );
}

function childFrameAt(
  rootFrame: ElectronWebFrameMainLike | undefined,
  frameIndex: number,
): ElectronWebFrameMainLike {
  if (!rootFrame) {
    throw new Error("Browser webContents does not expose frame tree");
  }
  const frame = rootFrame.frames[frameIndex];
  if (!frame || frame.detached === true || frame.isDestroyed?.() === true) {
    throw new Error(`Frame locator target is not available: ${frameIndex}`);
  }
  return frame;
}

function readFrameIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Frame locator target is not a frame");
  }
  return Math.floor(value);
}

function isFrameLocatorAccessibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Frame locator target is not accessible") ||
    message.includes("Blocked a frame") ||
    message.includes("Permission denied")
  );
}

function frameIndexScript(locator: BrowserLocatorDescriptor): string {
  return `(() => {
    const __backchatFrameLocator = ${JSON.stringify(locator)};
    ${LOCATOR_RUNTIME_SCRIPT}
    const frame = targetLocatorElement(
      resolveBackchatLocator(__backchatFrameLocator),
      __backchatFrameLocator
    );
    const tagName = String(frame.tagName || "").toLowerCase();
    if (tagName !== "iframe" && tagName !== "frame") {
      throw new Error("Frame locator target is not a frame");
    }
    return Array.from(document.querySelectorAll("iframe, frame")).indexOf(frame);
  })()`;
}

function locatorOperationScript(
  locator: BrowserLocatorDescriptor,
  operation: LocatorOperation,
  operationArgs: unknown[] = [],
): string {
  return `(() => {
    const __backchatLocator = ${JSON.stringify(locator)};
    const __backchatOperation = ${JSON.stringify(operation)};
    const __backchatOperationArgs = ${JSON.stringify(operationArgs)};
    ${LOCATOR_RUNTIME_SCRIPT}
    const elements = resolveBackchatLocator(__backchatLocator);
    if (__backchatOperation === "count") return elements.length;
    const element = targetLocatorElement(elements, __backchatLocator);
    if (__backchatOperation === "innerText") {
      return element.innerText || element.textContent || "";
    }
    if (__backchatOperation === "attribute") {
      return element.getAttribute(__backchatOperationArgs[0]);
    }
    if (__backchatOperation === "click") {
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      return null;
    }
    if (__backchatOperation === "fill") {
      element.focus();
      const text = __backchatOperationArgs[0];
      if ("value" in element) {
        element.value = text;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        element.textContent = text;
        element.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text
        }));
      }
      return null;
    }
    if (__backchatOperation === "press") {
      element.focus();
      const key = __backchatOperationArgs[0];
      for (const type of ["keydown", "keyup"]) {
        element.dispatchEvent(new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          key
        }));
      }
      return null;
    }
    if (__backchatOperation === "setChecked") {
      if (!("checked" in element)) {
        throw new Error("Locator target is not checkable");
      }
      element.checked = __backchatOperationArgs[0] === true;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return null;
    }
    if (__backchatOperation === "selectOption") {
      if (String(element.tagName || "").toLowerCase() !== "select") {
        throw new Error("Locator target is not a select element");
      }
      const values = __backchatOperationArgs[0];
      const selectedValues = Array.isArray(values) ? values.map(String) : [String(values)];
      for (const option of element.options) {
        option.selected = selectedValues.includes(option.value);
      }
      if (!element.multiple) {
        element.value = selectedValues[0] || "";
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return null;
    }
    throw new Error("Unsupported locator operation: " + String(__backchatOperation));
  })()`;
}

function locatorClickPointScript(locator: BrowserLocatorDescriptor): string {
  return `(() => {
    const __backchatLocator = ${JSON.stringify(locator)};
    ${LOCATOR_RUNTIME_SCRIPT}
    const element = targetLocatorElement(
      resolveBackchatLocator(__backchatLocator),
      __backchatLocator
    );
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  })()`;
}

function readLocatorClickPoint(value: unknown): { x: number; y: number } {
  if (
    !isRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  ) {
    throw new Error("Locator click did not return finite viewport coordinates");
  }
  return { x: value.x, y: value.y };
}

async function clickLocatorWithInputEvents(
  record: TabRecord,
  locator: BrowserLocatorDescriptor,
): Promise<void> {
  const wasVisible = record.win.isVisible();
  if (!wasVisible) {
    record.win.show();
    await delay(200);
  }
  try {
    const point = readLocatorClickPoint(
      await executeInTab(record, locatorClickPointScript(locator), true),
    );
    await sendMouseClick(record.win.webContents, point.x, point.y);
    await delay(100);
  } finally {
    if (!wasVisible) record.win.hide();
  }
}

async function sendMouseClick(webContents: ElectronWebContentsLike, x: number, y: number): Promise<void> {
  if (!webContents.sendInputEvent) {
    throw new Error("Browser webContents does not support input events");
  }
  const clickX = Math.round(x);
  const clickY = Math.round(y);
  webContents.sendInputEvent({ type: "mouseMove", x: clickX, y: clickY });
  await delay(20);
  webContents.sendInputEvent({ type: "mouseDown", x: clickX, y: clickY, button: "left", clickCount: 1 });
  webContents.sendInputEvent({ type: "mouseUp", x: clickX, y: clickY, button: "left", clickCount: 1 });
}

const LOCATOR_RUNTIME_SCRIPT = `
  const normalizeLocatorText = (value) =>
    String(value ?? "").replace(/\\s+/g, " ").trim();
  const locatorTextMatches = (actual, expected, exact) => {
    const normalizedActual = normalizeLocatorText(actual).toLowerCase();
    const normalizedExpected = normalizeLocatorText(expected).toLowerCase();
    return exact
      ? normalizedActual === normalizedExpected
      : normalizedActual.includes(normalizedExpected);
  };
  const locatorElementText = (element) =>
    normalizeLocatorText(element.innerText || element.textContent || "");
  const isLocatorElement = (element) =>
    !!element && element.nodeType === 1;
  const isLocatorVisible = (element) => {
    if (!isLocatorElement(element)) return false;
    const style = (element.ownerDocument?.defaultView || window).getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || locatorElementText(element).length > 0;
  };
  const leafMatches = (elements, predicate) => {
    const matched = elements.filter((element) => isLocatorVisible(element) && predicate(element));
    return matched.filter((element) =>
      !matched.some((candidate) => candidate !== element && element.contains(candidate))
    );
  };
  const allLocatorElements = (rootDocument) => {
    const seen = new Set();
    const elements = [];
    const visit = (element) => {
      if (!isLocatorElement(element) || seen.has(element)) return;
      seen.add(element);
      elements.push(element);
      const shadowRoot = element.shadowRoot;
      if (shadowRoot && typeof shadowRoot.querySelectorAll === "function") {
        for (const shadowElement of Array.from(shadowRoot.querySelectorAll("*"))) {
          visit(shadowElement);
        }
      }
    };
    for (const element of Array.from(rootDocument.querySelectorAll("body *"))) {
      visit(element);
    }
    return elements;
  };
  const queryLocatorElements = (rootDocument, selector) =>
    allLocatorElements(rootDocument).filter((element) => {
      try {
        return typeof element.matches === "function" && element.matches(selector);
      } catch {
        return false;
      }
    });
  const locatorElementById = (rootDocument, id) =>
    allLocatorElements(rootDocument).find((candidate) => candidate.getAttribute("id") === id);
  const implicitRole = (element) => {
    const role = element.getAttribute("role");
    if (role) return role;
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "img") return "img";
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      return "textbox";
    }
    return "";
  };
  const accessibleName = (element, rootDocument) => {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      return labelledBy
        .split(/\\s+/)
        .map((id) => {
          const label = locatorElementById(rootDocument, id);
          return label?.innerText || label?.textContent || "";
        })
        .join(" ");
    }
    if ("value" in element && element.value) return element.value;
    const alt = element.getAttribute("alt");
    if (alt) return alt;
    return locatorElementText(element);
  };
  const controlForLabel = (label, rootDocument) => {
    if (label.control) return label.control;
    const id = label.getAttribute("for");
    if (id) return locatorElementById(rootDocument, id);
    return label.querySelector("input, textarea, select, button, [contenteditable=true]");
  };
  function resolveBackchatLocator(locator, rootDocument = document) {
    if (!locator || typeof locator !== "object") {
      throw new Error("Locator must be an object");
    }
    if (locator.kind === "css") {
      return queryLocatorElements(rootDocument, locator.selector);
    }
    if (locator.kind === "testId") {
      return queryLocatorElements(rootDocument, "[data-testid], [data-test-id], [data-test]")
        .filter((element) =>
          element.getAttribute("data-testid") === locator.value ||
          element.getAttribute("data-test-id") === locator.value ||
          element.getAttribute("data-test") === locator.value
        );
    }
    if (locator.kind === "text") {
      return leafMatches(allLocatorElements(rootDocument), (element) =>
        locatorTextMatches(locatorElementText(element), locator.value, locator.exact === true)
      );
    }
    if (locator.kind === "label") {
      const controls = queryLocatorElements(rootDocument, "label")
        .filter((label) =>
          locatorTextMatches(locatorElementText(label), locator.value, locator.exact === true)
        )
        .map((label) => controlForLabel(label, rootDocument))
        .filter(Boolean);
      const ariaControls = queryLocatorElements(rootDocument, "input, textarea, select, button, [contenteditable=true]")
        .filter((element) => {
          const label = element.getAttribute("aria-label") || element.getAttribute("placeholder") || "";
          return locatorTextMatches(label, locator.value, locator.exact === true);
        });
      return [...controls, ...ariaControls];
    }
    if (locator.kind === "role") {
      return allLocatorElements(rootDocument).filter((element) => {
        if (!isLocatorVisible(element)) return false;
        if (implicitRole(element) !== locator.role) return false;
        if (!locator.name) return true;
        return locatorTextMatches(accessibleName(element, rootDocument), locator.name, locator.exact === true);
      });
    }
    if (locator.kind === "frame") {
      const frame = targetLocatorElement(resolveBackchatLocator(locator.frame, rootDocument), locator.frame);
      const frameDocument = frame.contentDocument;
      if (!frameDocument) {
        throw new Error("Frame locator target is not accessible");
      }
      return resolveBackchatLocator(locator.locator, frameDocument);
    }
    throw new Error("Unsupported locator kind: " + String(locator.kind));
  }
  function locatorTargetIndex(locator) {
    if (!locator || locator.index === undefined) return null;
    if (!Number.isInteger(locator.index) || locator.index < 0) {
      throw new Error("locator.index must be a non-negative integer");
    }
    return locator.index;
  }
  function targetLocatorElement(elements, locator) {
    const index = locatorTargetIndex(locator);
    if (index !== null) {
      const element = elements[index];
      if (!element) {
        throw new Error("No element matches locator index " + index + ": " + JSON.stringify(locator));
      }
      return element;
    }
    if (elements.length === 0) {
      throw new Error("No element matches locator: " + JSON.stringify(locator));
    }
    if (elements.length > 1) {
      throw new Error("Locator matched " + elements.length + " elements; pass locator.index after count to disambiguate: " + JSON.stringify(locator));
    }
    return elements[0];
  }
`;

function attachJavaScriptDialog(record: TabRecord): void {
  record.win.webContents.on("javascript-dialog-opening", (...args: unknown[]) => {
    const parsed = parseJavaScriptDialogArgs(args);
    parsed.event?.preventDefault?.();
    record.dialog = {
      type: parsed.type,
      message: parsed.message,
      ...(parsed.defaultValue ? { defaultValue: parsed.defaultValue } : {}),
      respond: parsed.respond,
    };
  });
}

function parseJavaScriptDialogArgs(args: unknown[]): {
  event?: { preventDefault?: () => void };
  type: BrowserDialogInfo["type"];
  message: string;
  defaultValue?: string;
  respond?: (accepted: boolean, promptText?: string) => void;
} {
  const event = isRecord(args[0])
    ? args[0] as { preventDefault?: () => void }
    : undefined;

  if (isRecord(args[1])) {
    const details = args[1];
    return {
      event,
      type: normalizeDialogType(details.type),
      message: typeof details.message === "string" ? details.message : "",
      defaultValue: typeof details.defaultPromptText === "string"
        ? details.defaultPromptText
        : undefined,
      respond: typeof args[2] === "function"
        ? args[2] as (accepted: boolean, promptText?: string) => void
        : undefined,
    };
  }

  return {
    event,
    message: typeof args[2] === "string" ? args[2] : "",
    type: normalizeDialogType(args[3]),
    defaultValue: typeof args[4] === "string" ? args[4] : undefined,
    respond: typeof args[5] === "function"
      ? args[5] as (accepted: boolean, promptText?: string) => void
      : undefined,
  };
}

function normalizeDialogType(value: unknown): BrowserDialogInfo["type"] {
  if (
    value === "alert" ||
    value === "confirm" ||
    value === "prompt" ||
    value === "beforeunload"
  ) {
    return value;
  }
  return "alert";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePageAssets(value: unknown): BrowserPageAssetEntry[] {
  if (!Array.isArray(value)) return [];
  const out: BrowserPageAssetEntry[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.url !== "string") continue;
    out.push({
      url: item.url,
      type: normalizePageAssetType(item.type),
      ...(typeof item.tagName === "string" ? { tagName: item.tagName } : {}),
      ...(typeof item.rel === "string" ? { rel: item.rel } : {}),
      ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}),
    });
  }
  return out;
}

function normalizePageAssetType(value: unknown): BrowserPageAssetEntry["type"] {
  if (
    value === "document" ||
    value === "script" ||
    value === "stylesheet" ||
    value === "image" ||
    value === "font" ||
    value === "media" ||
    value === "other"
  ) {
    return value;
  }
  return "other";
}

function toUint8Array(bytes: Uint8Array | Buffer): Uint8Array {
  return bytes instanceof Uint8Array
    ? bytes
    : Uint8Array.from(bytes);
}
