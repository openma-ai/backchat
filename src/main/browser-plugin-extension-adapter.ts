import { Buffer } from "node:buffer";

import type {
  BrowserBackendAdapter,
  BrowserDescriptor,
  BrowserDialogInfo,
  BrowserDevLogEntry,
  BrowserLocatorDescriptor,
  BrowserLocatorSelectValue,
  BrowserPageAssetEntry,
  BrowserScreenshotOptions,
  BrowserTabInfo,
} from "./browser-plugin-service.js";

export type ChromeExtensionBridgeCommand =
  | { id: string; type: "tabs.list" }
  | { id: string; type: "tabs.userOpenTabs" }
  | { id: string; type: "tabs.create" }
  | { id: string; type: "tab.goto"; tabId: string; url: string }
  | { id: string; type: "tab.close"; tabId: string }
  | { id: string; type: "tab.screenshot"; tabId: string; options?: BrowserScreenshotOptions }
  | { id: string; type: "tab.reload"; tabId: string }
  | { id: string; type: "tab.back"; tabId: string }
  | { id: string; type: "tab.forward"; tabId: string }
  | { id: string; type: "tab.devLogs"; tabId: string }
  | { id: string; type: "tab.domSnapshot"; tabId: string }
  | { id: string; type: "tab.pageAssets"; tabId: string }
  | { id: string; type: "tab.evaluate"; tabId: string; expression: string }
  | { id: string; type: "tab.click"; tabId: string; selector: string }
  | { id: string; type: "tab.type"; tabId: string; selector: string; text: string }
  | { id: string; type: "tab.keypress"; tabId: string; key: string }
  | { id: string; type: "tab.coordinateClick"; tabId: string; x: number; y: number }
  | { id: string; type: "tab.domCuaSnapshot"; tabId: string }
  | { id: string; type: "tab.domCuaClick"; tabId: string; nodeId: string }
  | { id: string; type: "tab.locatorCount"; tabId: string; locator: BrowserLocatorDescriptor }
  | { id: string; type: "tab.locatorClick"; tabId: string; locator: BrowserLocatorDescriptor }
  | {
      id: string;
      type: "tab.locatorFill";
      tabId: string;
      locator: BrowserLocatorDescriptor;
      text: string;
    }
  | {
      id: string;
      type: "tab.locatorPress";
      tabId: string;
      locator: BrowserLocatorDescriptor;
      key: string;
    }
  | {
      id: string;
      type: "tab.locatorSetChecked";
      tabId: string;
      locator: BrowserLocatorDescriptor;
      checked: boolean;
    }
  | {
      id: string;
      type: "tab.locatorSelectOption";
      tabId: string;
      locator: BrowserLocatorDescriptor;
      value: BrowserLocatorSelectValue;
    }
  | {
      id: string;
      type: "tab.locatorInnerText";
      tabId: string;
      locator: BrowserLocatorDescriptor;
    }
  | {
      id: string;
      type: "tab.locatorAttribute";
      tabId: string;
      locator: BrowserLocatorDescriptor;
      name: string;
    }
  | { id: string; type: "tab.dialog"; tabId: string }
  | { id: string; type: "tab.dialogAccept"; tabId: string; promptText?: string }
  | { id: string; type: "tab.dialogDismiss"; tabId: string };

export interface ChromeExtensionRegistration {
  extensionId: string;
  extensionVersion: string;
  instanceId: string;
  profileName?: string;
}

export interface ChromeExtensionBridgeHealth {
  status: "connected" | "disconnected" | "command-error" | "command-timeout";
  lastConnectedAt?: string;
  lastCommandAt?: string;
  lastCommandType?: string;
  lastError?: string;
  pendingCommandCount: number;
  queuedCommandCount: number;
}

export interface ChromeExtensionBridge {
  registration?: ChromeExtensionRegistration | null;
  health?: ChromeExtensionBridgeHealth;
  sendCommand(command: ChromeExtensionBridgeCommand): Promise<unknown>;
}

export function createChromeExtensionBrowserAdapter(options: {
  id?: string;
  name?: string;
  metadata?: Record<string, string> | (() => Record<string, string>);
  bridge: ChromeExtensionBridge;
}): BrowserBackendAdapter {
  let seq = 0;
  const descriptor = (): BrowserDescriptor => {
    const registration = options.bridge.registration ?? null;
    const metadata = typeof options.metadata === "function"
      ? options.metadata()
      : options.metadata;
    return {
      id: options.id ?? "chrome-extension",
      type: "extension",
      name: options.name ?? "Chrome Extension",
      metadata: {
        ...(metadata ?? {}),
        ...(registration ? { ...registration } : {}),
      },
      capabilities: {
        browser: [],
        tab: [
          {
            id: "history",
            description: "Reload and move backward or forward in tab history.",
          },
          {
            id: "pageAssets",
            description: "Inventory page assets observed by the Chrome extension.",
          },
          {
            id: "domSnapshot",
            description: "Capture readable text from the visible DOM.",
          },
          {
            id: "evaluate",
            description: "Evaluate JavaScript through chrome.scripting.",
          },
          {
            id: "input",
            description: "Click, type, and dispatch keypresses through the extension.",
          },
          {
            id: "cua",
            description: "Click viewport coordinates through page hit testing.",
          },
          {
            id: "domCua",
            description: "Inspect compact interactable DOM and click by node id.",
          },
          {
            id: "locators",
            description: "Find elements by CSS, text, label, role, or test id.",
          },
          {
            id: "dialogs",
            description: "Inspect and handle JavaScript dialogs through Chrome debugger.",
          },
        ],
      },
    };
  };
  const commandId = () => `chrome-${++seq}`;

  return {
    get descriptor() {
      return descriptor();
    },

    async listTabs() {
      return readTabs(await options.bridge.sendCommand({
        id: commandId(),
        type: "tabs.list",
      }));
    },

    async userTabs() {
      return readTabs(await options.bridge.sendCommand({
        id: commandId(),
        type: "tabs.userOpenTabs",
      }));
    },

    async createTab() {
      return readTab(await options.bridge.sendCommand({
        id: commandId(),
        type: "tabs.create",
      }));
    },

    async getTab(tabId) {
      const tabs = await this.listTabs();
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (!tab) throw new Error(`tabs.get could not find tab id "${tabId}"`);
      return tab;
    },

    async closeTab(tabId) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.close",
        tabId,
      });
    },

    async navigate(tabId, url) {
      return readTab(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.goto",
        tabId,
        url,
      }));
    },

    async reload(tabId) {
      return readTab(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.reload",
        tabId,
      }));
    },

    async back(tabId) {
      return readTab(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.back",
        tabId,
      }));
    },

    async forward(tabId) {
      return readTab(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.forward",
        tabId,
      }));
    },

    async screenshot(tabId, screenshotOptions?: BrowserScreenshotOptions) {
      const result = await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.screenshot",
        tabId,
        ...(screenshotOptions ? { options: screenshotOptions } : {}),
      });
      return decodeScreenshotResult(result);
    },

    async devLogs(tabId) {
      return readDevLogs(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.devLogs",
        tabId,
      }));
    },

    async pageAssets(tabId) {
      return readPageAssets(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.pageAssets",
        tabId,
      }));
    },

    async domSnapshot(tabId) {
      return String(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.domSnapshot",
        tabId,
      }));
    },

    async evaluate(tabId, expression) {
      return options.bridge.sendCommand({
        id: commandId(),
        type: "tab.evaluate",
        tabId,
        expression,
      });
    },

    async click(tabId, selector) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.click",
        tabId,
        selector,
      });
    },

    async type(tabId, selector, text) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.type",
        tabId,
        selector,
        text,
      });
    },

    async press(tabId, key) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.keypress",
        tabId,
        key,
      });
    },

    async coordinateClick(tabId, x, y) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.coordinateClick",
        tabId,
        x,
        y,
      });
    },

    async domCuaSnapshot(tabId) {
      return String(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.domCuaSnapshot",
        tabId,
      }));
    },

    async domCuaClick(tabId, nodeId) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.domCuaClick",
        tabId,
        nodeId,
      });
    },

    async locatorCount(tabId, locator) {
      return readNumber(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.locatorCount",
        tabId,
        locator,
      }), "Chrome extension returned invalid locator count");
    },

    async locatorClick(tabId, locator) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.locatorClick",
        tabId,
        locator,
      });
    },

    async locatorFill(tabId, locator, text) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.locatorFill",
        tabId,
        locator,
        text,
      });
    },

    async locatorPress(tabId, locator, key) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.locatorPress",
        tabId,
        locator,
        key,
      });
    },

    async locatorSetChecked(tabId, locator, checked) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.locatorSetChecked",
        tabId,
        locator,
        checked,
      });
    },

    async locatorSelectOption(tabId, locator, value) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.locatorSelectOption",
        tabId,
        locator,
        value,
      });
    },

    async locatorInnerText(tabId, locator) {
      return String(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.locatorInnerText",
        tabId,
        locator,
      }));
    },

    async locatorAttribute(tabId, locator, name) {
      const value = await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.locatorAttribute",
        tabId,
        locator,
        name,
      });
      return value === null || value === undefined ? null : String(value);
    },

    async getDialog(tabId) {
      return readDialog(await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.dialog",
        tabId,
      }));
    },

    async acceptDialog(tabId, promptText) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.dialogAccept",
        tabId,
        ...(promptText ? { promptText } : {}),
      });
    },

    async dismissDialog(tabId) {
      await options.bridge.sendCommand({
        id: commandId(),
        type: "tab.dialogDismiss",
        tabId,
      });
    },
  };
}

function readTabs(value: unknown): BrowserTabInfo[] {
  if (!Array.isArray(value)) throw new Error("Chrome extension returned invalid tabs list");
  return value.map(readTab);
}

function readTab(value: unknown): BrowserTabInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Chrome extension returned invalid tab");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") throw new Error("Chrome extension tab requires id");
  return {
    id: record.id,
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.url === "string" ? { url: record.url } : {}),
  };
}

function decodeScreenshotResult(value: unknown): { bytes: Uint8Array; mimeType?: string } {
  if (value instanceof Uint8Array) return { bytes: value };
  if (typeof value !== "string") {
    throw new Error("Chrome extension returned invalid screenshot");
  }
  const mimeType = value.startsWith("data:")
    ? value.slice(5, value.indexOf(";"))
    : undefined;
  const base64 = value.startsWith("data:")
    ? value.slice(value.indexOf(",") + 1)
    : value;
  return {
    bytes: Uint8Array.from(Buffer.from(base64, "base64")),
    ...(mimeType ? { mimeType } : {}),
  };
}

function readPageAssets(value: unknown): BrowserPageAssetEntry[] {
  if (!Array.isArray(value)) throw new Error("Chrome extension returned invalid page assets");
  const out: BrowserPageAssetEntry[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.url !== "string") continue;
    out.push({
      url: record.url,
      type: readPageAssetType(record.type),
      ...(typeof record.tagName === "string" ? { tagName: record.tagName } : {}),
      ...(typeof record.rel === "string" ? { rel: record.rel } : {}),
      ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
    });
  }
  return out;
}

function readDevLogs(value: unknown): BrowserDevLogEntry[] {
  if (!Array.isArray(value)) throw new Error("Chrome extension returned invalid dev logs");
  const out: BrowserDevLogEntry[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.message !== "string" || typeof record.timestamp !== "string") continue;
    out.push({
      level: readDevLogLevel(record.level),
      message: record.message,
      timestamp: record.timestamp,
      ...(typeof record.url === "string" ? { url: record.url } : {}),
    });
  }
  return out;
}

function readDialog(value: unknown): BrowserDialogInfo | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Chrome extension returned invalid dialog");
  }
  const record = value as Record<string, unknown>;
  if (
    record.type !== "alert" &&
    record.type !== "confirm" &&
    record.type !== "prompt" &&
    record.type !== "beforeunload"
  ) {
    throw new Error("Chrome extension dialog requires type");
  }
  if (typeof record.message !== "string") {
    throw new Error("Chrome extension dialog requires message");
  }
  return {
    type: record.type,
    message: record.message,
    ...(typeof record.defaultValue === "string" ? { defaultValue: record.defaultValue } : {}),
  };
}

function readDevLogLevel(value: unknown): BrowserDevLogEntry["level"] {
  if (
    value === "debug" ||
    value === "info" ||
    value === "log" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  return "log";
}

function readPageAssetType(value: unknown): BrowserPageAssetEntry["type"] {
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

function readNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(message);
  }
  return value;
}
