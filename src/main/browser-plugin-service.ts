import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { openmaRoot } from "./storage-root.js";

export type BrowserBackendType = "iab" | "extension" | "cdp";

export interface BrowserCapabilityInfo {
  id: string;
  description: string;
}

export interface BrowserDescriptor {
  id: string;
  type: BrowserBackendType;
  name: string;
  metadata?: Record<string, string>;
  capabilities: {
    browser: BrowserCapabilityInfo[];
    tab: BrowserCapabilityInfo[];
  };
}

export interface BrowserTabInfo {
  id: string;
  title?: string;
  url?: string;
}

export type BrowserLoadState = "domcontentloaded" | "load" | "networkidle";

export interface BrowserWaitForLoadStateParams {
  browser: string;
  tabId: string;
  state?: BrowserLoadState;
  timeoutMs?: number;
  pollMs?: number;
}

export interface BrowserViewportSize {
  width: number;
  height: number;
}

export interface BrowserViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserDevLogEntry {
  level: "debug" | "info" | "log" | "warn" | "error";
  message: string;
  timestamp: string;
  url?: string;
}

export type BrowserDevLogLevel = BrowserDevLogEntry["level"];

export interface BrowserDevLogsOptions {
  pageUrl?: string;
  levels?: BrowserDevLogLevel[];
  filter?: string;
  limit?: number;
}

export interface BrowserDevLogsParams extends BrowserDevLogsOptions {
  browser: string;
  tabId: string;
}

export interface BrowserAdapterScreenshotResult {
  bytes: Uint8Array;
  mimeType?: string;
}

export type BrowserPageAssetType =
  | "document"
  | "script"
  | "stylesheet"
  | "image"
  | "font"
  | "media"
  | "other";

export interface BrowserPageAssetEntry {
  url: string;
  type: BrowserPageAssetType;
  tagName?: string;
  rel?: string;
  mimeType?: string;
}

export type BrowserBundledAssetStatus = "saved" | "skipped" | "failed";

export interface BrowserBundledAssetEntry extends BrowserPageAssetEntry {
  status: BrowserBundledAssetStatus;
  path?: string;
  byteSize?: number;
  reason?: string;
}

export interface BrowserAssetBundleResult {
  directory: string;
  manifestPath: string;
  assets: BrowserBundledAssetEntry[];
}

export type BrowserDialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export interface BrowserDialogInfo {
  type: BrowserDialogType;
  message: string;
  defaultValue?: string;
}

export interface BrowserPluginStateEvent {
  type: "browser.state";
  browser: BrowserDescriptor;
  visible: boolean;
  activeTabId?: string;
  tabs: BrowserTabInfo[];
}

export interface BrowserLocatorTargetOptions {
  index?: number;
}

export type BrowserLocatorDescriptor =
  | (BrowserLocatorTargetOptions & { kind: "css"; selector: string })
  | (BrowserLocatorTargetOptions & { kind: "testId"; value: string })
  | (BrowserLocatorTargetOptions & { kind: "text"; value: string; exact?: boolean })
  | (BrowserLocatorTargetOptions & { kind: "label"; value: string; exact?: boolean })
  | (BrowserLocatorTargetOptions & { kind: "role"; role: string; name?: string; exact?: boolean })
  | (BrowserLocatorTargetOptions & {
      kind: "frame";
      frame: BrowserLocatorDescriptor;
      locator: BrowserLocatorDescriptor;
    });

export type BrowserLocatorSelectValue = string | string[];

export interface BrowserBackendAdapter {
  descriptor: BrowserDescriptor;
  listTabs(): Promise<BrowserTabInfo[]>;
  userTabs?(): Promise<BrowserTabInfo[]>;
  createTab(): Promise<BrowserTabInfo>;
  getTab(tabId: string): Promise<BrowserTabInfo>;
  closeTab(tabId: string): Promise<void>;
  navigate(tabId: string, url: string): Promise<BrowserTabInfo>;
  reload?(tabId: string): Promise<BrowserTabInfo>;
  back?(tabId: string): Promise<BrowserTabInfo>;
  forward?(tabId: string): Promise<BrowserTabInfo>;
  screenshot(
    tabId: string,
    options?: BrowserScreenshotOptions,
  ): Promise<Uint8Array | BrowserAdapterScreenshotResult>;
  devLogs(tabId: string): Promise<BrowserDevLogEntry[]>;
  pageAssets?(tabId: string): Promise<BrowserPageAssetEntry[]>;
  domSnapshot?(tabId: string): Promise<string>;
  evaluate?(tabId: string, expression: string): Promise<unknown>;
  click?(tabId: string, selector: string): Promise<void>;
  type?(tabId: string, selector: string, text: string): Promise<void>;
  press?(tabId: string, key: string): Promise<void>;
  coordinateClick?(tabId: string, x: number, y: number): Promise<void>;
  domCuaSnapshot?(tabId: string): Promise<string>;
  domCuaClick?(tabId: string, nodeId: string): Promise<void>;
  locatorCount?(tabId: string, locator: BrowserLocatorDescriptor): Promise<number>;
  locatorClick?(tabId: string, locator: BrowserLocatorDescriptor): Promise<void>;
  locatorFill?(
    tabId: string,
    locator: BrowserLocatorDescriptor,
    text: string,
  ): Promise<void>;
  locatorPress?(
    tabId: string,
    locator: BrowserLocatorDescriptor,
    key: string,
  ): Promise<void>;
  locatorSetChecked?(
    tabId: string,
    locator: BrowserLocatorDescriptor,
    checked: boolean,
  ): Promise<void>;
  locatorSelectOption?(
    tabId: string,
    locator: BrowserLocatorDescriptor,
    value: BrowserLocatorSelectValue,
  ): Promise<void>;
  locatorInnerText?(tabId: string, locator: BrowserLocatorDescriptor): Promise<string>;
  locatorAttribute?(
    tabId: string,
    locator: BrowserLocatorDescriptor,
    name: string,
  ): Promise<string | null>;
  getDialog?(tabId: string): Promise<BrowserDialogInfo | null>;
  acceptDialog?(tabId: string, promptText?: string): Promise<void>;
  dismissDialog?(tabId: string): Promise<void>;
  setViewport?(size: BrowserViewportSize): Promise<void>;
  resetViewport?(): Promise<void>;
  setVisibility?(visible: boolean): Promise<void>;
  getVisibility?(): Promise<boolean>;
  attachView?(
    tabId: string,
    target: {
      hostWindow: unknown;
      bounds: BrowserViewBounds;
      visible: boolean;
    },
  ): Promise<void>;
  detachView?(tabId: string): Promise<void>;
}

export interface BrowserScreenshotOptions {
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fullPage?: boolean;
}

export interface BrowserPluginService {
  onEvent(listener: (event: BrowserPluginStateEvent) => void): () => void;
  listBrowsers(): Promise<BrowserDescriptor[]>;
  getBrowser(ref: string): Promise<BrowserDescriptor>;
  listTabs(browser: string): Promise<BrowserTabInfo[]>;
  getTab(params: { browser: string; tabId: string }): Promise<BrowserTabInfo>;
  selectedTab(browser: string): Promise<BrowserTabInfo | null>;
  userOpenTabs(browser: string): Promise<BrowserTabInfo[]>;
  nameSession(params: { browser: string; name: string }): Promise<{ browser: string; name: string }>;
  getSessionName(browser: string): Promise<string | null>;
  selectTab(params: { browser: string; tabId: string }): Promise<BrowserTabInfo>;
  newTab(browser: string): Promise<BrowserTabInfo>;
  goto(params: { browser: string; tabId: string; url: string }): Promise<BrowserTabInfo>;
  reload(params: { browser: string; tabId: string }): Promise<BrowserTabInfo>;
  back(params: { browser: string; tabId: string }): Promise<BrowserTabInfo>;
  forward(params: { browser: string; tabId: string }): Promise<BrowserTabInfo>;
  waitForURL(params: {
    browser: string;
    tabId: string;
    url: string;
    waitUntil?: BrowserLoadState;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<BrowserTabInfo>;
  waitForLoadState(params: BrowserWaitForLoadStateParams): Promise<BrowserTabInfo>;
  title(params: { browser: string; tabId: string }): Promise<string | null>;
  url(params: { browser: string; tabId: string }): Promise<string | null>;
  closeTab(params: { browser: string; tabId: string }): Promise<void>;
  screenshot(params: {
    browser: string;
    tabId: string;
    options?: BrowserScreenshotOptions;
  }): Promise<{ bytes: Uint8Array; mimeType: string }>;
  setViewport(browser: string, size: BrowserViewportSize): Promise<void>;
  resetViewport(browser: string): Promise<void>;
  setVisibility(browser: string, visible: boolean): Promise<void>;
  getVisibility(browser: string): Promise<boolean>;
  attachView(params: {
    browser: string;
    tabId: string;
    hostWindow: unknown;
    bounds: BrowserViewBounds;
    visible?: boolean;
  }): Promise<void>;
  detachView(params: { browser: string; tabId: string }): Promise<void>;
  devLogs(params: BrowserDevLogsParams): Promise<BrowserDevLogEntry[]>;
  pageAssets(params: { browser: string; tabId: string }): Promise<BrowserPageAssetEntry[]>;
  bundleAssets(params: { browser: string; tabId: string }): Promise<BrowserAssetBundleResult>;
  domSnapshot(params: { browser: string; tabId: string }): Promise<string>;
  evaluate(params: { browser: string; tabId: string; expression: string }): Promise<unknown>;
  click(params: { browser: string; tabId: string; selector: string }): Promise<void>;
  type(params: { browser: string; tabId: string; selector: string; text: string }): Promise<void>;
  press(params: { browser: string; tabId: string; key: string }): Promise<void>;
  cuaClick(params: { browser: string; tabId: string; x: number; y: number }): Promise<void>;
  domCuaSnapshot(params: { browser: string; tabId: string }): Promise<string>;
  domCuaClick(params: { browser: string; tabId: string; nodeId: string }): Promise<void>;
  locatorCount(params: {
    browser: string;
    tabId: string;
    locator: BrowserLocatorDescriptor;
  }): Promise<number>;
  locatorClick(params: {
    browser: string;
    tabId: string;
    locator: BrowserLocatorDescriptor;
  }): Promise<void>;
  locatorFill(params: {
    browser: string;
    tabId: string;
    locator: BrowserLocatorDescriptor;
    text: string;
  }): Promise<void>;
  locatorPress(params: {
    browser: string;
    tabId: string;
    locator: BrowserLocatorDescriptor;
    key: string;
  }): Promise<void>;
  locatorSetChecked(params: {
    browser: string;
    tabId: string;
    locator: BrowserLocatorDescriptor;
    checked: boolean;
  }): Promise<void>;
  locatorSelectOption(params: {
    browser: string;
    tabId: string;
    locator: BrowserLocatorDescriptor;
    value: BrowserLocatorSelectValue;
  }): Promise<void>;
  locatorInnerText(params: {
    browser: string;
    tabId: string;
    locator: BrowserLocatorDescriptor;
  }): Promise<string>;
  locatorAttribute(params: {
    browser: string;
    tabId: string;
    locator: BrowserLocatorDescriptor;
    name: string;
  }): Promise<string | null>;
  getDialog(params: { browser: string; tabId: string }): Promise<BrowserDialogInfo | null>;
  acceptDialog(params: { browser: string; tabId: string; promptText?: string }): Promise<void>;
  dismissDialog(params: { browser: string; tabId: string }): Promise<void>;
  clipboardReadText(): Promise<string>;
  clipboardWriteText(text: string): Promise<void>;
}

export interface BrowserClipboard {
  readText(): string | Promise<string>;
  writeText(text: string): void | Promise<void>;
}

export interface BrowserAssetFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type BrowserAssetFetch = (url: string) => Promise<BrowserAssetFetchResponse>;

export type BrowserUrlPolicy = (url: string) => BrowserUrlPolicyResult;

export interface BrowserUrlPolicyResult {
  allowed: boolean;
  reason?: string;
}

export class BrowserUsePolicyError extends Error {
  readonly code = "BROWSER_URL_BLOCKED";

  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Browser URL blocked: ${reason}`);
    this.name = "BrowserUsePolicyError";
  }
}

export function createBrowserPluginService(options: {
  adapters: BrowserBackendAdapter[];
  urlPolicy?: BrowserUrlPolicy;
  clipboard?: BrowserClipboard;
  assetBundleRoot?: string;
  bundleId?: () => string;
  fetch?: BrowserAssetFetch;
}): BrowserPluginService {
  const adapters = options.adapters;
  const urlPolicy = options.urlPolicy ?? defaultBrowserUrlPolicy;
  const clipboard = options.clipboard ?? defaultBrowserClipboard;
  const assetBundleRoot = options.assetBundleRoot ?? join(openmaRoot(), "browser-assets");
  const bundleId = options.bundleId ?? randomUUID;
  const fetchAsset = options.fetch ?? defaultAssetFetch;
  const listeners = new Set<(event: BrowserPluginStateEvent) => void>();
  const activeTabByBrowser = new Map<string, string>();
  const sessionNameByBrowser = new Map<string, string>();

  const resolveAdapter = (ref: string): BrowserBackendAdapter => {
    const adapter = adapters.find((candidate) =>
      candidate.descriptor.id === ref ||
      candidate.descriptor.type === ref ||
      (ref === "chrome" && candidate.descriptor.type === "extension")
    );
    if (!adapter) throw new Error(`Browser is not available: ${ref}`);
    return adapter;
  };

  const descriptorFor = (adapter: BrowserBackendAdapter): BrowserDescriptor => {
    const sessionName = sessionNameByBrowser.get(adapter.descriptor.id);
    if (!sessionName) return adapter.descriptor;
    return {
      ...adapter.descriptor,
      metadata: {
        ...(adapter.descriptor.metadata ?? {}),
        sessionName,
      },
    };
  };

  const emitState = async (
    adapter: BrowserBackendAdapter,
    activeTabId?: string,
  ): Promise<void> => {
    if (listeners.size === 0) return;
    const tabs = await adapter.listTabs();
    const rememberedActiveTabId = activeTabId ?? activeTabByBrowser.get(adapter.descriptor.id);
    const activeExists = rememberedActiveTabId
      ? tabs.some((tab) => tab.id === rememberedActiveTabId)
      : false;
    const event: BrowserPluginStateEvent = {
      type: "browser.state",
      browser: descriptorFor(adapter),
      visible: adapter.getVisibility ? await adapter.getVisibility() : false,
      ...(activeExists && rememberedActiveTabId ? { activeTabId: rememberedActiveTabId } : {}),
      tabs,
    };
    for (const listener of listeners) listener(event);
  };

  return {
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async listBrowsers() {
      return adapters.map(descriptorFor);
    },

    async getBrowser(ref) {
      return descriptorFor(resolveAdapter(ref));
    },

    async listTabs(browser) {
      return resolveAdapter(browser).listTabs();
    },

    async getTab(params) {
      return readAdapterTab(resolveAdapter(params.browser), params.tabId);
    },

    async selectedTab(browser) {
      const adapter = resolveAdapter(browser);
      const activeTabId = activeTabByBrowser.get(adapter.descriptor.id);
      if (!activeTabId) return null;
      const tabs = await adapter.listTabs();
      return tabs.find((tab) => tab.id === activeTabId) ?? null;
    },

    async userOpenTabs(browser) {
      const adapter = resolveAdapter(browser);
      return adapter.userTabs ? adapter.userTabs() : [];
    },

    async nameSession(params) {
      const adapter = resolveAdapter(params.browser);
      const name = params.name.trim();
      if (!name) throw new Error("Browser session name cannot be empty");
      sessionNameByBrowser.set(adapter.descriptor.id, name);
      await emitState(adapter);
      return { browser: adapter.descriptor.id, name };
    },

    async getSessionName(browser) {
      const adapter = resolveAdapter(browser);
      return sessionNameByBrowser.get(adapter.descriptor.id) ?? null;
    },

    async selectTab(params) {
      const adapter = resolveAdapter(params.browser);
      const tab = await readAdapterTab(adapter, params.tabId);
      activeTabByBrowser.set(adapter.descriptor.id, params.tabId);
      await emitState(adapter, params.tabId);
      return tab;
    },

    async newTab(browser) {
      const adapter = resolveAdapter(browser);
      const tab = await adapter.createTab();
      activeTabByBrowser.set(adapter.descriptor.id, tab.id);
      await emitState(adapter, tab.id);
      return tab;
    },

    async goto(params) {
      const policy = urlPolicy(params.url);
      if (!policy.allowed) {
        throw new BrowserUsePolicyError(
          params.url,
          policy.reason ?? "blocked by browser URL policy",
        );
      }
      const adapter = resolveAdapter(params.browser);
      const tab = await adapter.navigate(params.tabId, params.url);
      activeTabByBrowser.set(adapter.descriptor.id, params.tabId);
      await emitState(adapter, params.tabId);
      return tab;
    },

    async reload(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.reload) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support reload`);
      }
      const tab = await adapter.reload(params.tabId);
      activeTabByBrowser.set(adapter.descriptor.id, params.tabId);
      await emitState(adapter, params.tabId);
      return tab;
    },

    async back(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.back) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support back`);
      }
      const tab = await adapter.back(params.tabId);
      activeTabByBrowser.set(adapter.descriptor.id, params.tabId);
      await emitState(adapter, params.tabId);
      return tab;
    },

    async forward(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.forward) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support forward`);
      }
      const tab = await adapter.forward(params.tabId);
      activeTabByBrowser.set(adapter.descriptor.id, params.tabId);
      await emitState(adapter, params.tabId);
      return tab;
    },

    async waitForURL(params) {
      const adapter = resolveAdapter(params.browser);
      const timeoutMs = normalizeWaitMs(params.timeoutMs, 30_000, "timeoutMs");
      const pollMs = normalizeWaitMs(params.pollMs, 50, "pollMs");
      const deadline = Date.now() + timeoutMs;
      const waitUntil = params.waitUntil ? normalizeLoadState(params.waitUntil) : undefined;
      let lastUrl: string | undefined;

      while (true) {
        const tab = await adapter.getTab(params.tabId);
        lastUrl = tab.url;
        if (tab.url === params.url) {
          if (waitUntil) {
            await waitForAdapterLoadState({
              adapter,
              tabId: params.tabId,
              targetState: waitUntil,
              deadline,
              pollMs,
            });
          }
          activeTabByBrowser.set(adapter.descriptor.id, params.tabId);
          await emitState(adapter, params.tabId);
          return tab;
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new Error(
            `Timed out waiting for tab ${params.tabId} to reach URL ${params.url}; last URL: ${lastUrl ?? "unknown"}`,
          );
        }
        await delay(Math.min(pollMs, remainingMs));
      }
    },

    async waitForLoadState(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.evaluate) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support evaluate`);
      }
      const targetState = normalizeLoadState(params.state);
      const timeoutMs = normalizeWaitMs(
        params.timeoutMs,
        30_000,
        "timeoutMs",
        "waitForLoadState",
      );
      const pollMs = normalizeWaitMs(
        params.pollMs,
        50,
        "pollMs",
        "waitForLoadState",
      );
      const deadline = Date.now() + timeoutMs;
      await waitForAdapterLoadState({
        adapter,
        tabId: params.tabId,
        targetState,
        deadline,
        pollMs,
      });
      const tab = await adapter.getTab(params.tabId);
      activeTabByBrowser.set(adapter.descriptor.id, params.tabId);
      await emitState(adapter, params.tabId);
      return tab;
    },

    async title(params) {
      return (await resolveAdapter(params.browser).getTab(params.tabId)).title ?? null;
    },

    async url(params) {
      return (await resolveAdapter(params.browser).getTab(params.tabId)).url ?? null;
    },

    async closeTab(params) {
      const adapter = resolveAdapter(params.browser);
      await adapter.closeTab(params.tabId);
      if (activeTabByBrowser.get(adapter.descriptor.id) === params.tabId) {
        activeTabByBrowser.delete(adapter.descriptor.id);
      }
      await emitState(adapter);
    },

    async screenshot(params) {
      const shot = await resolveAdapter(params.browser).screenshot(
        params.tabId,
        params.options,
      );
      const normalized = normalizeAdapterScreenshot(shot);
      return {
        bytes: normalized.bytes,
        mimeType: normalized.mimeType ?? sniffBrowserScreenshotMime(normalized.bytes),
      };
    },

    async setViewport(browser, size) {
      const adapter = resolveAdapter(browser);
      if (!adapter.setViewport) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support viewport`);
      }
      await adapter.setViewport(size);
    },

    async resetViewport(browser) {
      const adapter = resolveAdapter(browser);
      if (!adapter.resetViewport) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support viewport`);
      }
      await adapter.resetViewport();
    },

    async setVisibility(browser, visible) {
      const adapter = resolveAdapter(browser);
      if (!adapter.setVisibility) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support visibility`);
      }
      await adapter.setVisibility(visible);
      await emitState(adapter);
    },

    async getVisibility(browser) {
      const adapter = resolveAdapter(browser);
      if (!adapter.getVisibility) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support visibility`);
      }
      return adapter.getVisibility();
    },

    async attachView(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.attachView) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support attachable views`);
      }
      await adapter.attachView(params.tabId, {
        hostWindow: params.hostWindow,
        bounds: params.bounds,
        visible: params.visible ?? true,
      });
      activeTabByBrowser.set(adapter.descriptor.id, params.tabId);
      await emitState(adapter, params.tabId);
    },

    async detachView(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.detachView) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support attachable views`);
      }
      await adapter.detachView(params.tabId);
      await emitState(adapter, params.tabId);
    },

    async devLogs(params) {
      const logs = await resolveAdapter(params.browser).devLogs(params.tabId);
      return filterDevLogs(logs, params);
    },

    async pageAssets(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.pageAssets) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support page assets`);
      }
      return adapter.pageAssets(params.tabId);
    },

    async bundleAssets(params) {
      const assets = await this.pageAssets(params);
      const directory = join(assetBundleRoot, bundleId());
      const manifestPath = join(directory, "manifest.json");
      await mkdir(directory, { recursive: true });
      const bundled: BrowserBundledAssetEntry[] = [];

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i]!;
        bundled.push(await bundleOneAsset({
          asset,
          directory,
          index: i + 1,
          fetchAsset,
        }));
      }

      await writeFile(
        manifestPath,
        JSON.stringify({
          browser: params.browser,
          tabId: params.tabId,
          assets: bundled,
        }, null, 2),
        "utf8",
      );

      return { directory, manifestPath, assets: bundled };
    },

    async domSnapshot(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.domSnapshot) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support DOM snapshots`);
      }
      return adapter.domSnapshot(params.tabId);
    },

    async evaluate(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.evaluate) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support evaluate`);
      }
      return adapter.evaluate(params.tabId, params.expression);
    },

    async click(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.click) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support click`);
      }
      if (adapter.getDialog && await adapter.getDialog(params.tabId)) {
        throw new Error("Cannot click while a JavaScript dialog is active");
      }
      await adapter.click(params.tabId, params.selector);
    },

    async type(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.type) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support type`);
      }
      await adapter.type(params.tabId, params.selector, params.text);
    },

    async press(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.press) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support keypress`);
      }
      await adapter.press(params.tabId, params.key);
    },

    async cuaClick(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.coordinateClick) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support coordinate CUA`);
      }
      if (adapter.getDialog && await adapter.getDialog(params.tabId)) {
        throw new Error("Cannot click while a JavaScript dialog is active");
      }
      await adapter.coordinateClick(params.tabId, params.x, params.y);
    },

    async domCuaSnapshot(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.domCuaSnapshot) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support DOM CUA`);
      }
      return adapter.domCuaSnapshot(params.tabId);
    },

    async domCuaClick(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.domCuaClick) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support DOM CUA`);
      }
      if (adapter.getDialog && await adapter.getDialog(params.tabId)) {
        throw new Error("Cannot click while a JavaScript dialog is active");
      }
      await adapter.domCuaClick(params.tabId, params.nodeId);
    },

    async locatorCount(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.locatorCount) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support locators`);
      }
      return adapter.locatorCount(params.tabId, params.locator);
    },

    async locatorClick(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.locatorClick) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support locators`);
      }
      if (adapter.getDialog && await adapter.getDialog(params.tabId)) {
        throw new Error("Cannot click while a JavaScript dialog is active");
      }
      await adapter.locatorClick(params.tabId, params.locator);
    },

    async locatorFill(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.locatorFill) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support locators`);
      }
      await adapter.locatorFill(params.tabId, params.locator, params.text);
    },

    async locatorPress(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.locatorPress) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support locators`);
      }
      await adapter.locatorPress(params.tabId, params.locator, params.key);
    },

    async locatorSetChecked(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.locatorSetChecked) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support locators`);
      }
      await adapter.locatorSetChecked(params.tabId, params.locator, params.checked);
    },

    async locatorSelectOption(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.locatorSelectOption) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support locators`);
      }
      await adapter.locatorSelectOption(params.tabId, params.locator, params.value);
    },

    async locatorInnerText(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.locatorInnerText) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support locators`);
      }
      return adapter.locatorInnerText(params.tabId, params.locator);
    },

    async locatorAttribute(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.locatorAttribute) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support locators`);
      }
      return adapter.locatorAttribute(params.tabId, params.locator, params.name);
    },

    async getDialog(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.getDialog) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support dialogs`);
      }
      return adapter.getDialog(params.tabId);
    },

    async acceptDialog(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.acceptDialog) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support dialogs`);
      }
      await adapter.acceptDialog(params.tabId, params.promptText);
    },

    async dismissDialog(params) {
      const adapter = resolveAdapter(params.browser);
      if (!adapter.dismissDialog) {
        throw new Error(`Browser ${adapter.descriptor.id} does not support dialogs`);
      }
      await adapter.dismissDialog(params.tabId);
    },

    async clipboardReadText() {
      return clipboard.readText();
    },

    async clipboardWriteText(text) {
      await clipboard.writeText(text);
    },
  };
}

const defaultBrowserClipboard: BrowserClipboard = {
  async readText() {
    const { clipboard } = await import("electron");
    return clipboard.readText();
  },
  async writeText(text: string) {
    const { clipboard } = await import("electron");
    clipboard.writeText(text);
  },
};

async function bundleOneAsset(options: {
  asset: BrowserPageAssetEntry;
  directory: string;
  index: number;
  fetchAsset: BrowserAssetFetch;
}): Promise<BrowserBundledAssetEntry> {
  let parsed: URL;
  try {
    parsed = new URL(options.asset.url);
  } catch {
    return {
      ...options.asset,
      status: "skipped",
      reason: "invalid URL",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ...options.asset,
      status: "skipped",
      reason: `unsupported protocol: ${parsed.protocol}`,
    };
  }

  try {
    const response = await options.fetchAsset(options.asset.url);
    if (!response.ok) {
      return {
        ...options.asset,
        status: "failed",
        reason: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
      };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const filePath = join(
      options.directory,
      `${String(options.index).padStart(3, "0")}-${assetFileName(parsed)}`,
    );
    await writeFile(filePath, bytes);
    return {
      ...options.asset,
      status: "saved",
      path: filePath,
      mimeType: response.headers.get("content-type") ?? options.asset.mimeType,
      byteSize: bytes.byteLength,
    };
  } catch (error) {
    return {
      ...options.asset,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function assetFileName(url: URL): string {
  const rawName = basename(decodeURIComponent(url.pathname)) || "asset";
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safeName || "asset";
}

function normalizeWaitMs(
  value: number | undefined,
  fallback: number,
  name: string,
  operation = "waitForURL",
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${operation} requires finite ${name}`);
  }
  return Math.max(1, Math.floor(value));
}

function normalizeLoadState(state: BrowserLoadState | undefined): BrowserLoadState {
  if (state === undefined) return "load";
  if (state === "domcontentloaded" || state === "load" || state === "networkidle") {
    return state;
  }
  throw new Error(`Unsupported browser load state: ${String(state)}`);
}

async function readAdapterTab(
  adapter: BrowserBackendAdapter,
  tabId: string,
): Promise<BrowserTabInfo> {
  const tabs = await adapter.listTabs();
  if (!tabs.some((tab) => tab.id === tabId)) {
    throw new Error(
      `tabs.get could not find tab id "${tabId}"; open tabs: ${formatOpenTabIds(tabs)}`,
    );
  }
  return adapter.getTab(tabId);
}

function formatOpenTabIds(tabs: BrowserTabInfo[]): string {
  return tabs.length > 0 ? tabs.map((tab) => tab.id).join(", ") : "none";
}

async function waitForAdapterLoadState(options: {
  adapter: BrowserBackendAdapter;
  tabId: string;
  targetState: BrowserLoadState;
  deadline: number;
  pollMs: number;
}): Promise<void> {
  if (!options.adapter.evaluate) {
    throw new Error(`Browser ${options.adapter.descriptor.id} does not support evaluate`);
  }
  let lastReadyState: string | undefined;

  while (true) {
    const value = await options.adapter.evaluate(options.tabId, "document.readyState");
    lastReadyState = typeof value === "string" ? value : String(value ?? "");
    if (isReadyStateSatisfied(lastReadyState, options.targetState)) return;

    const remainingMs = options.deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Timed out waiting for tab ${options.tabId} to reach load state ${options.targetState}; last readyState: ${lastReadyState || "unknown"}`,
      );
    }
    await delay(Math.min(options.pollMs, remainingMs));
  }
}

function isReadyStateSatisfied(
  readyState: string,
  targetState: BrowserLoadState,
): boolean {
  if (targetState === "domcontentloaded") {
    return readyState === "interactive" || readyState === "complete";
  }
  return readyState === "complete";
}

function filterDevLogs(
  logs: BrowserDevLogEntry[],
  options: BrowserDevLogsOptions,
): BrowserDevLogEntry[] {
  let filtered = logs;
  if (options.pageUrl) {
    filtered = filtered.filter((entry) => entry.url === options.pageUrl);
  }
  if (options.levels && options.levels.length > 0) {
    const levels = new Set(options.levels);
    filtered = filtered.filter((entry) => levels.has(entry.level));
  }
  if (options.filter) {
    const needle = options.filter.toLowerCase();
    filtered = filtered.filter((entry) =>
      entry.message.toLowerCase().includes(needle) ||
      (entry.url ?? "").toLowerCase().includes(needle)
    );
  }
  if (options.limit !== undefined) {
    const limit = Math.max(0, Math.floor(options.limit));
    return filtered.slice(Math.max(0, filtered.length - limit));
  }
  return filtered;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultAssetFetch(url: string): Promise<BrowserAssetFetchResponse> {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("fetch is not available in this runtime");
  }
  return globalThis.fetch(url);
}

export function defaultBrowserUrlPolicy(url: string): BrowserUrlPolicyResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      allowed: false,
      reason: "invalid URL",
    };
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return { allowed: true };
  }
  if (parsed.protocol === "about:" && parsed.pathname === "blank") {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `blocked protocol: ${parsed.protocol}`,
  };
}

export function sniffBrowserScreenshotMime(bytes: Uint8Array): string {
  if (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

function normalizeAdapterScreenshot(
  value: Uint8Array | BrowserAdapterScreenshotResult,
): BrowserAdapterScreenshotResult {
  if (value instanceof Uint8Array) return { bytes: value };
  return {
    bytes: value.bytes,
    ...(value.mimeType ? { mimeType: value.mimeType } : {}),
  };
}
