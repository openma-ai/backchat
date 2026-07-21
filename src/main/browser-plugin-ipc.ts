import { Buffer } from "node:buffer";
import type { IpcMain, WebContents } from "electron";

import type {
  BrowserClickParams,
  BrowserCuaClickParams,
  BrowserDevLogLevel,
  BrowserDevLogsParams,
  BrowserDialogAcceptParams,
  BrowserDomCuaClickParams,
  BrowserEvaluateParams,
  BrowserGotoParams,
  BrowserAttachViewParams,
  BrowserLoadState,
  BrowserLocatorAttributeParams,
  BrowserLocatorDescriptor,
  BrowserLocatorFillParams,
  BrowserLocatorParams,
  BrowserLocatorPressParams,
  BrowserLocatorSelectOptionParams,
  BrowserLocatorSetCheckedParams,
  BrowserNameSessionParams,
  BrowserPressParams,
  BrowserScreenshotOptions,
  BrowserScreenshotParams,
  BrowserSetViewportParams,
  BrowserTabParams,
  BrowserTypeParams,
  BrowserVisibilityParams,
  BrowserWaitForLoadStateParams,
  BrowserWaitForURLParams,
} from "../shared/browser-plugin.js";
import { InvokeChannel } from "../shared/ipc-channels.js";
import type { BrowserPluginService } from "./browser-plugin-service.js";

export interface BrowserPluginIpcMain {
  handle(
    channel: string,
    handler: (event: unknown, payload?: unknown) => unknown,
  ): void;
}

export interface BrowserPluginIpcOptions {
  resolveHostWindow?: (event: unknown) => unknown | Promise<unknown>;
}

export function registerBrowserPluginIpc(
  ipcMain: Pick<IpcMain, "handle"> | BrowserPluginIpcMain,
  service: BrowserPluginService,
  options: BrowserPluginIpcOptions = {},
): void {
  const resolveHostWindow = options.resolveHostWindow ?? defaultResolveHostWindow;

  ipcMain.handle(InvokeChannel.BrowserList, () => service.listBrowsers());

  ipcMain.handle(InvokeChannel.BrowserGet, (_event, payload) =>
    service.getBrowser(readBrowser(payload)));

  ipcMain.handle(InvokeChannel.BrowserTabs, (_event, payload) =>
    service.listTabs(readBrowser(payload)));

  ipcMain.handle(InvokeChannel.BrowserGetTab, (_event, payload) =>
    service.getTab(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserSelectedTab, (_event, payload) =>
    service.selectedTab(readBrowser(payload)));

  ipcMain.handle(InvokeChannel.BrowserUserOpenTabs, (_event, payload) =>
    service.userOpenTabs(readBrowser(payload)));

  ipcMain.handle(InvokeChannel.BrowserSelectTab, (_event, payload) =>
    service.selectTab(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserNameSession, (_event, payload) =>
    service.nameSession(readNameSessionParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserSessionName, (_event, payload) =>
    service.getSessionName(readBrowser(payload)));

  ipcMain.handle(InvokeChannel.BrowserNewTab, (_event, payload) =>
    service.newTab(readBrowser(payload)));

  ipcMain.handle(InvokeChannel.BrowserGoto, (_event, payload) =>
    service.goto(readGotoParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserSetVisibility, async (_event, payload) => {
    const params = readVisibilityParams(payload);
    await service.setVisibility(params.browser, params.visible);
  });

  ipcMain.handle(InvokeChannel.BrowserGetVisibility, (_event, payload) =>
    service.getVisibility(readBrowser(payload)));

  ipcMain.handle(InvokeChannel.BrowserSetViewport, async (_event, payload) => {
    const params = readViewportParams(payload);
    await service.setViewport(params.browser, {
      width: params.width,
      height: params.height,
    });
  });

  ipcMain.handle(InvokeChannel.BrowserResetViewport, async (_event, payload) => {
    await service.resetViewport(readBrowser(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserAttachView, async (event, payload) => {
    const params = readAttachViewParams(payload);
    const hostWindow = await resolveHostWindow(event);
    await service.attachView({
      ...params,
      hostWindow,
      visible: params.visible ?? true,
    });
  });

  ipcMain.handle(InvokeChannel.BrowserDetachView, async (_event, payload) => {
    await service.detachView(readTabParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserReload, (_event, payload) =>
    service.reload(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserBack, (_event, payload) =>
    service.back(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserForward, (_event, payload) =>
    service.forward(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserWaitForURL, (_event, payload) =>
    service.waitForURL(readWaitForURLParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserWaitForLoadState, (_event, payload) =>
    service.waitForLoadState(readWaitForLoadStateParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserTitle, (_event, payload) =>
    service.title(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserUrl, (_event, payload) =>
    service.url(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserCloseTab, async (_event, payload) => {
    await service.closeTab(readTabParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserScreenshot, async (_event, payload) => {
    const shot = await service.screenshot(readScreenshotParams(payload));
    return {
      mimeType: shot.mimeType,
      base64: Buffer.from(shot.bytes).toString("base64"),
    };
  });

  ipcMain.handle(InvokeChannel.BrowserDevLogs, (_event, payload) => {
    return service.devLogs(readDevLogsParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserPageAssets, (_event, payload) =>
    service.pageAssets(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserBundleAssets, (_event, payload) =>
    service.bundleAssets(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserDomSnapshot, (_event, payload) =>
    service.domSnapshot(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserEvaluate, (_event, payload) =>
    service.evaluate(readEvaluateParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserClick, async (_event, payload) => {
    await service.click(readClickParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserType, async (_event, payload) => {
    await service.type(readTypeParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserPress, async (_event, payload) => {
    await service.press(readPressParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserCuaClick, async (_event, payload) => {
    await service.cuaClick(readCuaClickParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserDomCuaSnapshot, (_event, payload) =>
    service.domCuaSnapshot(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserDomCuaClick, async (_event, payload) => {
    await service.domCuaClick(readDomCuaClickParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserLocatorCount, (_event, payload) =>
    service.locatorCount(readLocatorParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserLocatorClick, async (_event, payload) => {
    await service.locatorClick(readLocatorParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserLocatorFill, async (_event, payload) => {
    await service.locatorFill(readLocatorFillParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserLocatorPress, async (_event, payload) => {
    await service.locatorPress(readLocatorPressParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserLocatorSetChecked, async (_event, payload) => {
    await service.locatorSetChecked(readLocatorSetCheckedParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserLocatorSelectOption, async (_event, payload) => {
    await service.locatorSelectOption(readLocatorSelectOptionParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserLocatorInnerText, (_event, payload) =>
    service.locatorInnerText(readLocatorParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserLocatorAttribute, (_event, payload) =>
    service.locatorAttribute(readLocatorAttributeParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserDialog, (_event, payload) =>
    service.getDialog(readTabParams(payload)));

  ipcMain.handle(InvokeChannel.BrowserAcceptDialog, async (_event, payload) => {
    await service.acceptDialog(readDialogAcceptParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserDismissDialog, async (_event, payload) => {
    await service.dismissDialog(readTabParams(payload));
  });

  ipcMain.handle(InvokeChannel.BrowserClipboardReadText, () =>
    service.clipboardReadText());

  ipcMain.handle(InvokeChannel.BrowserClipboardWriteText, async (_event, payload) => {
    if (!isRecord(payload) || typeof payload.text !== "string") {
      throw new Error("browser clipboard payload requires text");
    }
    await service.clipboardWriteText(payload.text);
  });
}

function readBrowser(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.browser !== "string") {
    throw new Error("browser payload requires browser");
  }
  return payload.browser;
}

function readGotoParams(payload: unknown): BrowserGotoParams {
  const params = readTabParams(payload);
  if (!isRecord(payload) || typeof payload.url !== "string") {
    throw new Error("browser:goto payload requires url");
  }
  return { ...params, url: payload.url };
}

function readNameSessionParams(payload: unknown): BrowserNameSessionParams {
  if (
    !isRecord(payload) ||
    typeof payload.browser !== "string" ||
    typeof payload.name !== "string"
  ) {
    throw new Error("browser nameSession payload requires browser and name");
  }
  return {
    browser: payload.browser,
    name: payload.name,
  };
}

function readVisibilityParams(payload: unknown): BrowserVisibilityParams {
  if (
    !isRecord(payload) ||
    typeof payload.browser !== "string" ||
    typeof payload.visible !== "boolean"
  ) {
    throw new Error("browser visibility payload requires browser and visible");
  }
  return {
    browser: payload.browser,
    visible: payload.visible,
  };
}

function readViewportParams(payload: unknown): BrowserSetViewportParams {
  if (
    !isRecord(payload) ||
    typeof payload.browser !== "string" ||
    typeof payload.width !== "number" ||
    typeof payload.height !== "number" ||
    !Number.isFinite(payload.width) ||
    !Number.isFinite(payload.height)
  ) {
    throw new Error("browser viewport payload requires browser, width, and height");
  }
  return {
    browser: payload.browser,
    width: payload.width,
    height: payload.height,
  };
}

function readAttachViewParams(payload: unknown): BrowserAttachViewParams {
  const params = readTabParams(payload);
  if (!isRecord(payload) || !isRecord(payload.bounds)) {
    throw new Error("browser attach view payload requires bounds");
  }
  const bounds = payload.bounds;
  const x = readFiniteBound(bounds, "x");
  const y = readFiniteBound(bounds, "y");
  const width = readFiniteBound(bounds, "width");
  const height = readFiniteBound(bounds, "height");
  if (width <= 0 || height <= 0) {
    throw new Error("browser attach view payload requires positive bounds");
  }
  return {
    ...params,
    bounds: { x, y, width, height },
    ...(typeof payload.visible === "boolean" ? { visible: payload.visible } : {}),
  };
}

function readFiniteBound(
  bounds: Record<string, unknown>,
  key: "x" | "y" | "width" | "height",
): number {
  const value = bounds[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("browser attach view payload requires finite bounds");
  }
  return value;
}

function readTabParams(payload: unknown): BrowserTabParams {
  if (
    !isRecord(payload) ||
    typeof payload.browser !== "string" ||
    typeof payload.tabId !== "string"
  ) {
    throw new Error("browser tab payload requires browser and tabId");
  }
  return {
    browser: payload.browser,
    tabId: payload.tabId,
  };
}

function readWaitForLoadStateParams(payload: unknown): BrowserWaitForLoadStateParams {
  const params = readTabParams(payload);
  if (!isRecord(payload)) return params;
  return {
    ...params,
    ...(payload.state !== undefined ? { state: readLoadState(payload.state) } : {}),
    ...(payload.timeoutMs !== undefined
      ? { timeoutMs: readFiniteWaitNumber(payload.timeoutMs, "timeoutMs") }
      : {}),
    ...(payload.pollMs !== undefined
      ? { pollMs: readFiniteWaitNumber(payload.pollMs, "pollMs") }
      : {}),
  };
}

function readWaitForURLParams(payload: unknown): BrowserWaitForURLParams {
  const params = readTabParams(payload);
  if (!isRecord(payload) || typeof payload.url !== "string") {
    throw new Error("browser wait for URL payload requires url");
  }
  return {
    ...params,
    url: payload.url,
    ...(payload.waitUntil !== undefined ? { waitUntil: readLoadState(payload.waitUntil) } : {}),
    ...(payload.timeoutMs !== undefined
      ? { timeoutMs: readFiniteWaitNumber(payload.timeoutMs, "timeoutMs") }
      : {}),
    ...(payload.pollMs !== undefined
      ? { pollMs: readFiniteWaitNumber(payload.pollMs, "pollMs") }
      : {}),
  };
}

function readLoadState(value: unknown): BrowserLoadState {
  if (
    value === "domcontentloaded" ||
    value === "load" ||
    value === "networkidle"
  ) {
    return value;
  }
  throw new Error("browser load-state payload requires supported state");
}

function readFiniteWaitNumber(value: unknown, name: "timeoutMs" | "pollMs"): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new Error(`browser load-state payload requires non-negative ${name}`);
  }
  return value;
}

function readScreenshotParams(payload: unknown): BrowserScreenshotParams {
  const params = readTabParams(payload);
  if (!isRecord(payload) || !isRecord(payload.options)) {
    return params;
  }
  const options = readScreenshotOptions(payload.options);
  return Object.keys(options).length > 0 ? { ...params, options } : params;
}

function readScreenshotOptions(value: Record<string, unknown>): BrowserScreenshotOptions {
  return {
    ...(isRecord(value.clip) ? { clip: readScreenshotClip(value.clip) } : {}),
    ...(typeof value.fullPage === "boolean" ? { fullPage: value.fullPage } : {}),
  };
}

function readScreenshotClip(value: Record<string, unknown>): NonNullable<BrowserScreenshotOptions["clip"]> {
  const x = readFiniteScreenshotNumber(value, "x");
  const y = readFiniteScreenshotNumber(value, "y");
  const width = readPositiveScreenshotNumber(value, "width");
  const height = readPositiveScreenshotNumber(value, "height");
  return { x, y, width, height };
}

function readFiniteScreenshotNumber(
  value: Record<string, unknown>,
  key: "x" | "y" | "width" | "height",
): number {
  const number = value[key];
  if (typeof number !== "number" || !Number.isFinite(number)) {
    throw new Error("browser screenshot payload requires finite clip values");
  }
  return number;
}

function readPositiveScreenshotNumber(
  value: Record<string, unknown>,
  key: "width" | "height",
): number {
  const number = readFiniteScreenshotNumber(value, key);
  if (number <= 0) {
    throw new Error("browser screenshot payload requires positive clip size");
  }
  return number;
}

function readDevLogsParams(payload: unknown): BrowserDevLogsParams {
  const params = readTabParams(payload);
  if (!isRecord(payload)) return params;
  return {
    ...params,
    ...(typeof payload.pageUrl === "string" && payload.pageUrl !== ""
      ? { pageUrl: payload.pageUrl }
      : {}),
    ...(Array.isArray(payload.levels) && payload.levels.length > 0
      ? { levels: readDevLogLevels(payload.levels) }
      : {}),
    ...(typeof payload.filter === "string" && payload.filter !== ""
      ? { filter: payload.filter }
      : {}),
    ...(payload.limit !== undefined ? { limit: readDevLogLimit(payload.limit) } : {}),
  };
}

function readDevLogLevels(value: unknown[]): BrowserDevLogLevel[] {
  const levels = new Set(["debug", "info", "log", "warn", "error"]);
  if (!value.every((item): item is BrowserDevLogLevel =>
    typeof item === "string" && levels.has(item)
  )) {
    throw new Error("browser dev logs payload requires valid levels");
  }
  return value as BrowserDevLogLevel[];
}

function readDevLogLimit(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error("browser dev logs payload requires non-negative integer limit");
  }
  return value;
}

function readEvaluateParams(payload: unknown): BrowserEvaluateParams {
  const params = readTabParams(payload);
  if (!isRecord(payload) || typeof payload.expression !== "string") {
    throw new Error("browser evaluate payload requires expression");
  }
  return {
    ...params,
    expression: payload.expression,
  };
}

function readClickParams(payload: unknown): BrowserClickParams {
  const params = readTabParams(payload);
  if (!isRecord(payload) || typeof payload.selector !== "string") {
    throw new Error("browser click payload requires selector");
  }
  return {
    ...params,
    selector: payload.selector,
  };
}

function readTypeParams(payload: unknown): BrowserTypeParams {
  const params = readClickParams(payload);
  if (!isRecord(payload) || typeof payload.text !== "string") {
    throw new Error("browser type payload requires text");
  }
  return {
    ...params,
    text: payload.text,
  };
}

function readPressParams(payload: unknown): BrowserPressParams {
  const params = readTabParams(payload);
  if (!isRecord(payload) || typeof payload.key !== "string") {
    throw new Error("browser press payload requires key");
  }
  return {
    ...params,
    key: payload.key,
  };
}

function readCuaClickParams(payload: unknown): BrowserCuaClickParams {
  const params = readTabParams(payload);
  if (
    !isRecord(payload) ||
    typeof payload.x !== "number" ||
    typeof payload.y !== "number" ||
    !Number.isFinite(payload.x) ||
    !Number.isFinite(payload.y)
  ) {
    throw new Error("browser CUA click payload requires finite x and y");
  }
  return {
    ...params,
    x: payload.x,
    y: payload.y,
  };
}

function readDomCuaClickParams(payload: unknown): BrowserDomCuaClickParams {
  const params = readTabParams(payload);
  if (!isRecord(payload) || typeof payload.nodeId !== "string" || !payload.nodeId) {
    throw new Error("browser DOM CUA click payload requires nodeId");
  }
  return {
    ...params,
    nodeId: payload.nodeId,
  };
}

function readDialogAcceptParams(payload: unknown): BrowserDialogAcceptParams {
  const params = readTabParams(payload);
  return {
    ...params,
    ...(isRecord(payload) && typeof payload.promptText === "string"
      ? { promptText: payload.promptText }
      : {}),
  };
}

function readLocatorParams(payload: unknown): BrowserLocatorParams {
  return {
    ...readTabParams(payload),
    locator: readLocator(payload),
  };
}

function readLocatorFillParams(payload: unknown): BrowserLocatorFillParams {
  if (!isRecord(payload) || typeof payload.text !== "string") {
    throw new Error("browser locator fill payload requires text");
  }
  return {
    ...readLocatorParams(payload),
    text: payload.text,
  };
}

function readLocatorPressParams(payload: unknown): BrowserLocatorPressParams {
  if (!isRecord(payload) || typeof payload.key !== "string" || payload.key === "") {
    throw new Error("browser locator press payload requires key");
  }
  return {
    ...readLocatorParams(payload),
    key: payload.key,
  };
}

function readLocatorSetCheckedParams(payload: unknown): BrowserLocatorSetCheckedParams {
  if (!isRecord(payload) || typeof payload.checked !== "boolean") {
    throw new Error("browser locator checked payload requires checked");
  }
  return {
    ...readLocatorParams(payload),
    checked: payload.checked,
  };
}

function readLocatorSelectOptionParams(payload: unknown): BrowserLocatorSelectOptionParams {
  if (!isRecord(payload)) {
    throw new Error("browser locator select payload requires value");
  }
  if (typeof payload.value === "string" && payload.value !== "") {
    return {
      ...readLocatorParams(payload),
      value: payload.value,
    };
  }
  if (
    Array.isArray(payload.value) &&
    payload.value.length > 0 &&
    payload.value.every((item) => typeof item === "string" && item !== "")
  ) {
    return {
      ...readLocatorParams(payload),
      value: payload.value,
    };
  }
  throw new Error("browser locator select payload requires value");
}

function readLocatorAttributeParams(payload: unknown): BrowserLocatorAttributeParams {
  if (!isRecord(payload) || typeof payload.name !== "string" || payload.name === "") {
    throw new Error("browser locator attribute payload requires name");
  }
  return {
    ...readLocatorParams(payload),
    name: payload.name,
  };
}

function readLocator(payload: unknown): BrowserLocatorDescriptor {
  if (!isRecord(payload) || !isRecord(payload.locator)) {
    throw new Error("browser locator payload requires locator");
  }
  return readLocatorDescriptor(payload.locator);
}

function readLocatorDescriptor(locator: Record<string, unknown>): BrowserLocatorDescriptor {
  const index = readLocatorIndex(locator);
  if (locator.kind === "css" && typeof locator.selector === "string" && locator.selector !== "") {
    return { kind: "css", selector: locator.selector, ...index };
  }
  if (locator.kind === "testId" && typeof locator.value === "string" && locator.value !== "") {
    return { kind: "testId", value: locator.value, ...index };
  }
  if (
    (locator.kind === "text" || locator.kind === "label") &&
    typeof locator.value === "string" &&
    locator.value !== ""
  ) {
    return {
      kind: locator.kind,
      value: locator.value,
      ...(typeof locator.exact === "boolean" ? { exact: locator.exact } : {}),
      ...index,
    };
  }
  if (locator.kind === "role" && typeof locator.role === "string" && locator.role !== "") {
    return {
      kind: "role",
      role: locator.role,
      ...(typeof locator.name === "string" && locator.name !== "" ? { name: locator.name } : {}),
      ...(typeof locator.exact === "boolean" ? { exact: locator.exact } : {}),
      ...index,
    };
  }
  if (locator.kind === "frame" && isRecord(locator.frame) && isRecord(locator.locator)) {
    return {
      kind: "frame",
      frame: readLocatorDescriptor(locator.frame),
      locator: readLocatorDescriptor(locator.locator),
      ...index,
    };
  }
  throw new Error("browser locator payload requires supported locator");
}

function readLocatorIndex(locator: Record<string, unknown>): { index?: number } {
  if (locator.index === undefined) return {};
  if (
    typeof locator.index !== "number" ||
    !Number.isInteger(locator.index) ||
    locator.index < 0
  ) {
    throw new Error("browser locator payload requires non-negative integer locator.index");
  }
  return { index: locator.index };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function defaultResolveHostWindow(event: unknown): Promise<unknown> {
  const sender = isRecord(event) ? event.sender : undefined;
  if (!sender) {
    throw new Error("browser attach view requires sender webContents");
  }
  const { BrowserWindow } = await import("electron");
  const hostWindow = BrowserWindow.fromWebContents(sender as WebContents);
  if (!hostWindow) {
    throw new Error("browser attach view requires an owning BrowserWindow");
  }
  return hostWindow;
}
