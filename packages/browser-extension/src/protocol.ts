export const BACKCHAT_BROWSER_EXTENSION_PROTOCOL_VERSION = 1;

export interface ExtensionRegisterPayload {
  protocolVersion: typeof BACKCHAT_BROWSER_EXTENSION_PROTOCOL_VERSION;
  type: "extension.register";
  extensionId: string;
  extensionVersion: string;
  instanceId: string;
  profileName?: string;
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

export interface BrowserScreenshotOptions {
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fullPage?: boolean;
}

export type BridgeCommand =
  | {
      id: string;
      type: "tabs.create";
    }
  | {
      id: string;
      type: "tab.goto";
      tabId: string;
      url: string;
    }
  | {
      id: string;
      type: "tab.close";
      tabId: string;
    }
  | {
      id: string;
      type: "tab.screenshot";
      tabId: string;
      options?: BrowserScreenshotOptions;
    }
  | {
      id: string;
      type: "tab.reload";
      tabId: string;
    }
  | {
      id: string;
      type: "tab.back";
      tabId: string;
    }
  | {
      id: string;
      type: "tab.forward";
      tabId: string;
    }
  | {
      id: string;
      type: "tab.devLogs";
      tabId: string;
    }
  | {
      id: string;
      type: "tab.domSnapshot";
      tabId: string;
    }
  | {
      id: string;
      type: "tab.pageAssets";
      tabId: string;
    }
  | {
      id: string;
      type: "tab.evaluate";
      tabId: string;
      expression: string;
    }
  | {
      id: string;
      type: "tab.click";
      tabId: string;
      selector: string;
    }
  | {
      id: string;
      type: "tab.type";
      tabId: string;
      selector: string;
      text: string;
    }
  | {
      id: string;
      type: "tab.keypress";
      tabId: string;
      key: string;
    }
  | {
      id: string;
      type: "tab.coordinateClick";
      tabId: string;
      x: number;
      y: number;
    }
  | {
      id: string;
      type: "tab.domCuaSnapshot";
      tabId: string;
    }
  | {
      id: string;
      type: "tab.domCuaClick";
      tabId: string;
      nodeId: string;
    }
  | {
      id: string;
      type: "tab.locatorCount";
      tabId: string;
      locator: BrowserLocatorDescriptor;
    }
  | {
      id: string;
      type: "tab.locatorClick";
      tabId: string;
      locator: BrowserLocatorDescriptor;
    }
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
  | {
      id: string;
      type: "tab.dialog";
      tabId: string;
    }
  | {
      id: string;
      type: "tab.dialogAccept";
      tabId: string;
      promptText?: string;
    }
  | {
      id: string;
      type: "tab.dialogDismiss";
      tabId: string;
    }
  | {
      id: string;
      type: "tabs.list";
    }
  | {
      id: string;
      type: "tabs.userOpenTabs";
    };

export function createExtensionRegisterPayload(options: {
  extensionId: string;
  extensionVersion: string;
  instanceId: string;
  profileName?: string;
}): ExtensionRegisterPayload {
  return {
    protocolVersion: BACKCHAT_BROWSER_EXTENSION_PROTOCOL_VERSION,
    type: "extension.register",
    extensionId: options.extensionId,
    extensionVersion: options.extensionVersion,
    instanceId: options.instanceId,
    ...(options.profileName ? { profileName: options.profileName } : {}),
  };
}

export function parseBridgeCommand(value: unknown): BridgeCommand {
  if (!isRecord(value)) {
    throw new Error("Bridge command must be an object");
  }
  const id = readString(value, "id");
  const type = readString(value, "type");
  if (!id) throw new Error("Bridge command requires id");
  if (!type) throw new Error("Bridge command requires type");

  if (type === "tabs.list") {
    return { id, type };
  }
  if (type === "tabs.userOpenTabs") {
    return { id, type };
  }
  if (type === "tabs.create") {
    return { id, type };
  }

  if (!isSupportedTabCommand(type)) {
    throw new Error(`Unsupported bridge command: ${type}`);
  }

  const tabId = readString(value, "tabId");
  if (!tabId) throw new Error(`${type} command requires tabId`);

  if (type === "tab.screenshot") {
    return { id, type, tabId, ...readScreenshotOptions(value.options, type) };
  }

  if (
    type === "tab.close" ||
    type === "tab.reload" ||
    type === "tab.back" ||
    type === "tab.forward" ||
    type === "tab.devLogs" ||
    type === "tab.domSnapshot" ||
    type === "tab.domCuaSnapshot" ||
    type === "tab.pageAssets" ||
    type === "tab.dialog" ||
    type === "tab.dialogDismiss"
  ) {
    return { id, type, tabId };
  }

  if (type === "tab.dialogAccept") {
    return {
      id,
      type,
      tabId,
      ...(typeof value.promptText === "string" ? { promptText: value.promptText } : {}),
    };
  }

  if (type === "tab.goto") {
    const url = readString(value, "url");
    if (!url) throw new Error("tab.goto command requires url");
    return { id, type, tabId, url };
  }

  if (type === "tab.evaluate") {
    const expression = readString(value, "expression");
    if (!expression) throw new Error("tab.evaluate command requires expression");
    return { id, type, tabId, expression };
  }

  if (type === "tab.click") {
    const selector = readString(value, "selector");
    if (!selector) throw new Error("tab.click command requires selector");
    return { id, type, tabId, selector };
  }

  if (type === "tab.type") {
    const selector = readString(value, "selector");
    if (!selector) throw new Error("tab.type command requires selector");
    const text = readString(value, "text");
    if (text === null) throw new Error("tab.type command requires text");
    return { id, type, tabId, selector, text };
  }

  if (type === "tab.keypress") {
    const key = readString(value, "key");
    if (!key) throw new Error("tab.keypress command requires key");
    return { id, type, tabId, key };
  }

  if (type === "tab.coordinateClick") {
    const x = readFiniteNumber(value, "x");
    const y = readFiniteNumber(value, "y");
    if (x === null || y === null) {
      throw new Error("tab.coordinateClick command requires finite x and y");
    }
    return { id, type, tabId, x, y };
  }

  if (type === "tab.domCuaClick") {
    const nodeId = readString(value, "nodeId");
    if (!nodeId) throw new Error("tab.domCuaClick command requires nodeId");
    return { id, type, tabId, nodeId };
  }

  if (
    type === "tab.locatorCount" ||
    type === "tab.locatorClick" ||
    type === "tab.locatorInnerText"
  ) {
    const locator = readLocator(value.locator, type);
    return { id, type, tabId, locator };
  }

  if (type === "tab.locatorFill") {
    const locator = readLocator(value.locator, type);
    const text = readString(value, "text");
    if (text === null) throw new Error("tab.locatorFill command requires text");
    return { id, type, tabId, locator, text };
  }

  if (type === "tab.locatorAttribute") {
    const locator = readLocator(value.locator, type);
    const name = readString(value, "name");
    if (!name) throw new Error("tab.locatorAttribute command requires name");
    return { id, type, tabId, locator, name };
  }

  if (type === "tab.locatorPress") {
    const locator = readLocator(value.locator, type);
    const key = readString(value, "key");
    if (!key) throw new Error("tab.locatorPress command requires key");
    return { id, type, tabId, locator, key };
  }

  if (type === "tab.locatorSetChecked") {
    const locator = readLocator(value.locator, type);
    if (typeof value.checked !== "boolean") {
      throw new Error("tab.locatorSetChecked command requires checked");
    }
    return { id, type, tabId, locator, checked: value.checked };
  }

  if (type === "tab.locatorSelectOption") {
    const locator = readLocator(value.locator, type);
    const selectValue = readSelectValue(value.value);
    if (selectValue === null) {
      throw new Error("tab.locatorSelectOption command requires value");
    }
    return { id, type, tabId, locator, value: selectValue };
  }

  throw new Error(`Unsupported bridge command: ${type}`);
}

function isSupportedTabCommand(
  type: string,
): type is Exclude<BridgeCommand["type"], "tabs.list" | "tabs.userOpenTabs" | "tabs.create"> {
  return (
    type === "tab.goto" ||
    type === "tab.close" ||
    type === "tab.screenshot" ||
    type === "tab.reload" ||
    type === "tab.back" ||
    type === "tab.forward" ||
    type === "tab.devLogs" ||
    type === "tab.domSnapshot" ||
    type === "tab.pageAssets" ||
    type === "tab.evaluate" ||
    type === "tab.click" ||
    type === "tab.type" ||
    type === "tab.keypress" ||
    type === "tab.coordinateClick" ||
    type === "tab.domCuaSnapshot" ||
    type === "tab.domCuaClick" ||
    type === "tab.dialog" ||
    type === "tab.dialogAccept" ||
    type === "tab.dialogDismiss" ||
    type === "tab.locatorCount" ||
    type === "tab.locatorClick" ||
    type === "tab.locatorFill" ||
    type === "tab.locatorPress" ||
    type === "tab.locatorSetChecked" ||
    type === "tab.locatorSelectOption" ||
    type === "tab.locatorInnerText" ||
    type === "tab.locatorAttribute"
  );
}

function readSelectValue(value: unknown): BrowserLocatorSelectValue | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    return value;
  }
  return null;
}

function readScreenshotOptions(
  value: unknown,
  context: string,
): { options?: BrowserScreenshotOptions } {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`${context} command requires options`);
  }
  const options: BrowserScreenshotOptions = {};
  if (value.fullPage !== undefined) {
    if (typeof value.fullPage !== "boolean") {
      throw new Error(`${context} command requires boolean fullPage`);
    }
    options.fullPage = value.fullPage;
  }
  if (value.clip !== undefined) {
    if (!isRecord(value.clip)) {
      throw new Error(`${context} command requires clip`);
    }
    const x = readFiniteNumber(value.clip, "x");
    const y = readFiniteNumber(value.clip, "y");
    const width = readFiniteNumber(value.clip, "width");
    const height = readFiniteNumber(value.clip, "height");
    if (x === null || y === null) {
      throw new Error(`${context} command requires finite clip x and y`);
    }
    if (width === null || height === null || width <= 0 || height <= 0) {
      throw new Error(`${context} command requires positive clip width and height`);
    }
    options.clip = { x, y, width, height };
  }
  return Object.keys(options).length > 0 ? { options } : {};
}

function readLocator(value: unknown, context: string): BrowserLocatorDescriptor {
  if (!isRecord(value)) {
    throw new Error(`${context} command requires locator`);
  }
  const kind = readString(value, "kind");
  const index = readLocatorIndex(value, context);
  if (kind === "css") {
    const selector = readString(value, "selector");
    if (!selector) throw new Error(`${context} command requires locator.selector`);
    return { kind, selector, ...index };
  }
  if (kind === "testId") {
    const locatorValue = readString(value, "value");
    if (!locatorValue) throw new Error(`${context} command requires locator.value`);
    return { kind, value: locatorValue, ...index };
  }
  if (kind === "text" || kind === "label") {
    const locatorValue = readString(value, "value");
    if (!locatorValue) throw new Error(`${context} command requires locator.value`);
    return {
      kind,
      value: locatorValue,
      ...(typeof value.exact === "boolean" ? { exact: value.exact } : {}),
      ...index,
    };
  }
  if (kind === "role") {
    const role = readString(value, "role");
    if (!role) throw new Error(`${context} command requires locator.role`);
    return {
      kind,
      role,
      ...(typeof value.name === "string" && value.name.length > 0
        ? { name: value.name }
        : {}),
      ...(typeof value.exact === "boolean" ? { exact: value.exact } : {}),
      ...index,
    };
  }
  if (kind === "frame") {
    if (!isRecord(value.frame)) {
      throw new Error(`${context} command requires locator.frame`);
    }
    if (!isRecord(value.locator)) {
      throw new Error(`${context} command requires locator.locator`);
    }
    return {
      kind,
      frame: readLocator(value.frame, context),
      locator: readLocator(value.locator, context),
      ...index,
    };
  }
  throw new Error(`${context} command requires supported locator.kind`);
}

function readLocatorIndex(
  value: Record<string, unknown>,
  context: string,
): { index?: number } {
  if (value.index === undefined) return {};
  if (
    typeof value.index !== "number" ||
    !Number.isInteger(value.index) ||
    value.index < 0
  ) {
    throw new Error(`${context} command requires locator.index`);
  }
  return { index: value.index };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
