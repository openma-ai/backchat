const PROTOCOL_VERSION = 1;
const BRIDGE_PORT_KEY = "backchatBridgePort";
const BRIDGE_PAUSED_KEY = "backchatBridgePaused";
const INSTANCE_KEY = "backchatInstanceId";
const POLL_ALARM_NAME = "backchatBridgePoll";
const DEFAULT_BRIDGE_PORT = 29174;
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const IDLE_POLL_MS = 1000;
const ERROR_POLL_MS = 3000;
const REGISTER_TIMEOUT_MS = 5000;
const COMMAND_POLL_TIMEOUT_MS = 30000;
let pollTimer = null;
let isPolling = false;
const debuggerTabs = new Set();
const dialogsByTabId = new Map();
const dialogWaitersByTabId = new Map();
const bridgeStatus = {
  status: "disconnected",
  lastConnectedAt: null,
  lastCommandAt: null,
  lastCommandType: null,
  lastError: null,
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInstanceId();
  scheduleBridgePoll(1);
});

chrome.runtime.onStartup?.addListener(() => {
  scheduleBridgePoll(1);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) void pollBackchatBridge();
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (typeof source.tabId !== "number") return;
  if (method === "Page.javascriptDialogOpening") {
    dialogsByTabId.set(source.tabId, {
      type: normalizeDialogType(params?.type),
      message: String(params?.message ?? ""),
      ...(params?.type === "prompt" && typeof params?.defaultPrompt === "string"
        ? { defaultValue: params.defaultPrompt }
        : {}),
    });
    resolveDialogWaiters(source.tabId);
  }
  if (method === "Page.javascriptDialogClosed") {
    dialogsByTabId.delete(source.tabId);
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (typeof source.tabId !== "number") return;
  debuggerTabs.delete(source.tabId);
  dialogsByTabId.delete(source.tabId);
  dialogWaitersByTabId.delete(source.tabId);
});

scheduleBridgePoll(1);
void refreshBridgeBadge();
void pollBackchatBridge();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }),
  );
  return true;
});

async function handleMessage(message) {
  if (message?.type === "bridge.status") {
    return readPopupStatus();
  }
  if (message?.type === "bridge.registerPayload") {
    const stored = await chrome.storage.local.get([INSTANCE_KEY]);
    return createExtensionRegisterPayload({
      extensionId: chrome.runtime.id,
      extensionVersion: chrome.runtime.getManifest().version,
      instanceId: stored[INSTANCE_KEY] ?? crypto.randomUUID(),
      profileName: message.profileName,
    });
  }
  if (message?.type === "bridge.command") {
    const command = parseBridgeCommand(message.command);
    return executeCommand(command);
  }
  if (message?.type === "bridge.setPort") {
    const port = Number(message.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Bridge port must be between 1 and 65535");
    }
    await chrome.storage.local.set({ [BRIDGE_PORT_KEY]: message.port });
    await updateBridgeStatus({ status: "disconnected", lastError: null });
    void pollBackchatBridge();
    return null;
  }
  if (message?.type === "bridge.setPaused") {
    const paused = message.paused === true;
    await chrome.storage.local.set({ [BRIDGE_PAUSED_KEY]: paused });
    await updateBridgeStatus({
      status: paused ? "paused" : "disconnected",
      lastError: null,
    });
    if (!paused) void pollBackchatBridge();
    return null;
  }
  throw new Error(`Unsupported message: ${message?.type ?? "unknown"}`);
}

async function ensureInstanceId() {
  const existing = await chrome.storage.local.get([INSTANCE_KEY]);
  if (existing[INSTANCE_KEY]) return existing[INSTANCE_KEY];
  const instanceId = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTANCE_KEY]: instanceId });
  return instanceId;
}

async function getBridgeBaseUrl() {
  const stored = await chrome.storage.local.get([BRIDGE_PORT_KEY]);
  const port = Number(stored[BRIDGE_PORT_KEY] ?? DEFAULT_BRIDGE_PORT);
  return `http://localhost:${Number.isFinite(port) ? port : DEFAULT_BRIDGE_PORT}`;
}

async function readBridgePort() {
  const stored = await chrome.storage.local.get([BRIDGE_PORT_KEY]);
  const port = Number(stored[BRIDGE_PORT_KEY] ?? DEFAULT_BRIDGE_PORT);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_BRIDGE_PORT;
}

async function isBridgePaused() {
  const stored = await chrome.storage.local.get([BRIDGE_PAUSED_KEY]);
  return stored[BRIDGE_PAUSED_KEY] === true;
}

async function readPopupStatus() {
  const paused = await isBridgePaused();
  const instanceId = await ensureInstanceId();
  return {
    status: paused ? "paused" : bridgeStatus.status,
    paused,
    bridgePort: await readBridgePort(),
    extensionId: chrome.runtime.id,
    extensionVersion: chrome.runtime.getManifest().version,
    instanceId,
    lastConnectedAt: bridgeStatus.lastConnectedAt,
    lastCommandAt: bridgeStatus.lastCommandAt,
    lastCommandType: bridgeStatus.lastCommandType,
    lastError: bridgeStatus.lastError,
  };
}

async function refreshBridgeBadge() {
  await updateActionBadge((await isBridgePaused()) ? "paused" : bridgeStatus.status);
}

async function updateBridgeStatus(next) {
  Object.assign(bridgeStatus, next);
  const paused = await isBridgePaused();
  const status = paused ? "paused" : bridgeStatus.status;
  await updateActionBadge(status);
}

async function updateActionBadge(status) {
  const text = status === "connected" ? "ON" : status === "paused" ? "PAUSE" : "OFF";
  const color = status === "connected"
    ? "#4b7a5f"
    : status === "paused"
      ? "#8a8179"
      : "#9b6757";
  try {
    await chrome.action?.setBadgeText?.({ text });
    await chrome.action?.setBadgeBackgroundColor?.({ color });
    await chrome.action?.setTitle?.({
      title: status === "connected"
        ? "Backchat Browser Bridge connected"
        : status === "paused"
          ? "Backchat Browser Bridge paused"
          : "Backchat Browser Bridge disconnected",
    });
  } catch {
    // Older Chromium builds or enterprise policy may reject badge updates.
  }
}

function scheduleBridgePoll(delayMs) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  const when = Date.now() + Math.max(1, delayMs);
  if (chrome.alarms?.create) {
    chrome.alarms.clear(POLL_ALARM_NAME, () => {
      chrome.alarms.create(POLL_ALARM_NAME, { when });
    });
    return;
  }
  pollTimer = setTimeout(() => {
    void pollBackchatBridge();
  }, delayMs);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REGISTER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function pollBackchatBridge() {
  if (isPolling) return;
  isPolling = true;
  try {
    if (await isBridgePaused()) {
      await updateBridgeStatus({ status: "paused", lastError: null });
      scheduleBridgePoll(IDLE_POLL_MS);
      return;
    }
    const baseUrl = await getBridgeBaseUrl();
    const instanceId = await ensureInstanceId();
    const registerResponse = await fetchWithTimeout(`${baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createExtensionRegisterPayload({
        extensionId: chrome.runtime.id,
        extensionVersion: chrome.runtime.getManifest().version,
        instanceId,
      })),
    });
    if (!registerResponse.ok) throw new Error(`Backchat bridge returned ${registerResponse.status}`);
    await updateBridgeStatus({
      status: "connected",
      lastConnectedAt: new Date().toISOString(),
      lastError: null,
    });

    const next = await fetchWithTimeout(
      `${baseUrl}/commands/next?instanceId=${encodeURIComponent(instanceId)}`,
      {},
      COMMAND_POLL_TIMEOUT_MS,
    );
    if (next.status === 204) {
      scheduleBridgePoll(IDLE_POLL_MS);
      return;
    }
    if (!next.ok) throw new Error(`Backchat bridge returned ${next.status}`);
    const command = parseBridgeCommand(await next.json());
    await updateBridgeStatus({
      lastCommandAt: new Date().toISOString(),
      lastCommandType: command.type,
    });
    try {
      const result = await executeCommand(command);
      await postCommandResult(baseUrl, instanceId, command.id, { ok: true, result });
    } catch (error) {
      await updateBridgeStatus({
        lastError: String(error?.message ?? error),
      });
      await postCommandResult(baseUrl, instanceId, command.id, {
        ok: false,
        error: String(error?.message ?? error),
      });
    }
    scheduleBridgePoll(0);
  } catch (error) {
    await updateBridgeStatus({
      status: "disconnected",
      lastError: String(error?.message ?? error),
    });
    scheduleBridgePoll(ERROR_POLL_MS);
  } finally {
    isPolling = false;
  }
}

async function postCommandResult(baseUrl, instanceId, id, payload) {
  await fetch(`${baseUrl}/commands/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      instanceId,
      id,
      ...payload,
    }),
  });
}

function createExtensionRegisterPayload(options) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "extension.register",
    extensionId: options.extensionId,
    extensionVersion: options.extensionVersion,
    instanceId: options.instanceId,
    ...(options.profileName ? { profileName: options.profileName } : {}),
  };
}

function parseBridgeCommand(value) {
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
  if (type === "tab.screenshot") {
    return { id, type, tabId, ...readScreenshotOptions(value.options, type) };
  }
  if (type === "tab.dialogAccept") {
    return {
      id,
      type,
      tabId,
      ...(typeof value.promptText === "string" ? { promptText: value.promptText } : {}),
    };
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
  const url = readString(value, "url");
  if (!url) throw new Error("tab.goto command requires url");
  return { id, type, tabId, url };
}

function isSupportedTabCommand(type) {
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

function readSelectValue(value) {
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

function readScreenshotOptions(value, context) {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`${context} command requires options`);
  }
  const options = {};
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

function readLocator(value, context) {
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

function readLocatorIndex(value, context) {
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record, key) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readFiniteNumber(record, key) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function executeCommand(command) {
  if (command.type === "tabs.list") {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({
      id: String(tab.id),
      title: tab.title,
      url: tab.url,
    }));
  }
  if (command.type === "tabs.userOpenTabs") {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({
      id: String(tab.id),
      title: tab.title,
      url: tab.url,
    }));
  }
  if (command.type === "tabs.create") {
    const tab = await chrome.tabs.create({ active: true });
    return { id: String(tab.id), title: tab.title, url: tab.url };
  }
  const tabId = Number(command.tabId);
  if (!Number.isFinite(tabId)) throw new Error(`Invalid tab id: ${command.tabId}`);

  if (command.type === "tab.goto") {
    const tab = await chrome.tabs.update(tabId, { url: command.url });
    await waitForTabComplete(tabId);
    await ensureDebuggerAttached(tabId);
    await installConsoleHook(tabId);
    const current = await chrome.tabs.get(tabId);
    return { id: String(current.id), title: current.title, url: current.url };
  }
  if (command.type === "tab.close") {
    await detachDebugger(tabId);
    await chrome.tabs.remove(tabId);
    return null;
  }
  if (command.type === "tab.screenshot") {
    return captureTabScreenshot(tabId, command.options);
  }
  if (command.type === "tab.reload") {
    await chrome.tabs.reload(tabId);
    const tab = await chrome.tabs.get(tabId);
    return { id: String(tab.id), title: tab.title, url: tab.url };
  }
  if (command.type === "tab.back") {
    await chrome.tabs.goBack(tabId);
    const tab = await chrome.tabs.get(tabId);
    return { id: String(tab.id), title: tab.title, url: tab.url };
  }
  if (command.type === "tab.forward") {
    await chrome.tabs.goForward(tabId);
    const tab = await chrome.tabs.get(tabId);
    return { id: String(tab.id), title: tab.title, url: tab.url };
  }
  if (command.type === "tab.devLogs") {
    await installConsoleHook(tabId);
    return readConsoleLogs(tabId);
  }
  if (command.type === "tab.dialog") {
    await ensureDebuggerAttached(tabId);
    return dialogsByTabId.get(tabId) ?? null;
  }
  if (command.type === "tab.dialogAccept") {
    await handleJavaScriptDialog(tabId, true, command.promptText);
    return null;
  }
  if (command.type === "tab.dialogDismiss") {
    await handleJavaScriptDialog(tabId, false);
    return null;
  }
  if (command.type === "tab.domSnapshot") {
    return executeScript(tabId, () => document.body?.innerText ?? document.body?.textContent ?? "");
  }
  if (command.type === "tab.pageAssets") {
    return executeScript(tabId, () => {
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
      for (const node of document.querySelectorAll("img[src], source[src], video[src], audio[src]")) {
        const tagName = node.tagName.toLowerCase();
        const type = tagName === "img" || tagName === "source" ? "image" : "media";
        push(node, node.getAttribute("src"), type);
      }
      return assets;
    });
  }
  if (command.type === "tab.evaluate") {
    await installConsoleHook(tabId);
    return executeMainWorldScript(tabId, (expression) => (0, eval)(expression), [command.expression]);
  }
  if (command.type === "tab.click") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    const point = await executeScript(tabId, (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`No element matches selector: ${selector}`);
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }, [command.selector]);
    await dispatchMouseClick(tabId, point);
    return null;
  }
  if (command.type === "tab.type") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    return executeScript(tabId, (selector, text) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`No element matches selector: ${selector}`);
      element.focus();
      if ("value" in element) {
        element.value = text;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        element.textContent = text;
        element.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        }));
      }
      return null;
    }, [command.selector, command.text]);
  }
  if (command.type === "tab.keypress") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    return executeScript(tabId, (key) => {
      const target = document.activeElement ?? document.body ?? document.documentElement;
      for (const type of ["keydown", "keyup"]) {
        target.dispatchEvent(new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          key,
        }));
      }
      return null;
    }, [command.key]);
  }
  if (command.type === "tab.coordinateClick") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    await dispatchMouseClick(tabId, { x: command.x, y: command.y });
    return null;
  }
  if (command.type === "tab.domCuaSnapshot") {
    return executeDomCuaScript(tabId, "snapshot");
  }
  if (command.type === "tab.domCuaClick") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    const point = readViewportPoint(
      await executeDomCuaScript(tabId, "centerPoint", [command.nodeId]),
      "DOM CUA click target did not resolve to viewport coordinates",
    );
    await dispatchMouseClick(tabId, point);
    return null;
  }
  if (command.type === "tab.locatorCount") {
    return executeLocatorScript(tabId, command.locator, "count");
  }
  if (command.type === "tab.locatorInnerText") {
    return executeLocatorScript(tabId, command.locator, "innerText");
  }
  if (command.type === "tab.locatorAttribute") {
    return executeLocatorScript(tabId, command.locator, "attribute", [command.name]);
  }
  if (command.type === "tab.locatorClick") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    const point = await resolveLocatorClickPoint(tabId, command.locator);
    await dispatchMouseClick(tabId, point);
    return null;
  }
  if (command.type === "tab.locatorFill") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    return executeLocatorScript(tabId, command.locator, "fill", [command.text]);
  }
  if (command.type === "tab.locatorPress") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    return executeLocatorScript(tabId, command.locator, "press", [command.key]);
  }
  if (command.type === "tab.locatorSetChecked") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    return executeLocatorScript(tabId, command.locator, "setChecked", [command.checked]);
  }
  if (command.type === "tab.locatorSelectOption") {
    await installConsoleHook(tabId);
    await ensureDebuggerAttached(tabId);
    return executeLocatorScript(tabId, command.locator, "selectOption", [command.value]);
  }
  throw new Error(`Unsupported command: ${command.type}`);
}

async function executeScript(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return results[0]?.result ?? null;
}

async function executeScriptInFrame(tabId, frameId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: frameId === 0 ? { tabId } : { tabId, frameIds: [frameId] },
    func,
    args,
  });
  return results[0]?.result ?? null;
}

async function executeMainWorldScript(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args,
  });
  return results[0]?.result ?? null;
}

async function captureTabScreenshot(tabId, options = {}) {
  await ensureDebuggerAttached(tabId);
  const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
  const pageMetrics = await readScreenshotPageMetrics(tabId);
  const clip = readScreenshotClip(metrics, options, pageMetrics);
  const viewport = readScreenshotViewport(metrics, pageMetrics);
  await chrome.debugger.sendCommand(
    { tabId },
    "Emulation.setDeviceMetricsOverride",
    {
      width: Math.ceil(viewport.width),
      height: Math.ceil(viewport.height),
      deviceScaleFactor: 1,
      mobile: false,
    },
  );
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      {
        format: "jpeg",
        quality: 85,
        ...(options.fullPage || options.clip ? { captureBeyondViewport: true } : {}),
        clip,
      },
    );
    const data = typeof result?.data === "string" ? result.data : "";
    if (!data) throw new Error("Chrome debugger returned an empty screenshot");
    return `data:image/jpeg;base64,${data}`;
  } finally {
    await chrome.debugger
      .sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride")
      .catch(() => undefined);
  }
}

async function readScreenshotPageMetrics(tabId) {
  try {
    const metrics = await executeScript(tabId, () => {
      const documentElement = document.documentElement;
      const body = document.body;
      const viewportWidth = documentElement?.clientWidth || window.innerWidth || 1;
      const viewportHeight = window.innerHeight || documentElement?.clientHeight || 1;
      return {
        scrollX: window.scrollX || window.pageXOffset || 0,
        scrollY: window.scrollY || window.pageYOffset || 0,
        viewportWidth,
        viewportHeight,
        documentWidth: Math.max(
          viewportWidth,
          documentElement?.scrollWidth || 0,
          body?.scrollWidth || 0,
          documentElement?.offsetWidth || 0,
          body?.offsetWidth || 0,
        ),
        documentHeight: Math.max(
          viewportHeight,
          documentElement?.scrollHeight || 0,
          body?.scrollHeight || 0,
          documentElement?.offsetHeight || 0,
          body?.offsetHeight || 0,
        ),
      };
    });
    return metrics && typeof metrics === "object" ? metrics : null;
  } catch {
    return null;
  }
}

function readScreenshotClip(metrics, options, pageMetrics) {
  if (options?.clip) {
    return { ...options.clip, scale: 1 };
  }
  const layoutViewport = metrics?.cssLayoutViewport ?? metrics?.layoutViewport ?? {};
  const visualViewport = metrics?.cssVisualViewport ?? metrics?.visualViewport ?? {};
  const contentSize = metrics?.cssContentSize ?? metrics?.contentSize ?? {};
  if (options?.fullPage === true) {
    return {
      x: 0,
      y: 0,
      width: readPositiveMetric(pageMetrics?.viewportWidth) ??
        readPositiveMetric(contentSize.width) ??
        readPositiveMetric(layoutViewport.clientWidth) ??
        readPositiveMetric(visualViewport.clientWidth) ??
        1,
      height: readPositiveMetric(pageMetrics?.documentHeight) ??
        readPositiveMetric(contentSize.height) ??
        readPositiveMetric(layoutViewport.clientHeight) ??
        readPositiveMetric(visualViewport.clientHeight) ??
        1,
      scale: 1,
    };
  }
  return {
    x: readFiniteMetric(pageMetrics?.scrollX) ??
      readFiniteMetric(layoutViewport.pageX) ??
      readFiniteMetric(visualViewport.pageX) ??
      0,
    y: readFiniteMetric(pageMetrics?.scrollY) ??
      readFiniteMetric(layoutViewport.pageY) ??
      readFiniteMetric(visualViewport.pageY) ??
      0,
    width: readPositiveMetric(pageMetrics?.viewportWidth) ??
      readPositiveMetric(layoutViewport.clientWidth) ??
      readPositiveMetric(visualViewport.clientWidth) ??
      readPositiveMetric(contentSize.width) ??
      1,
    height: readPositiveMetric(pageMetrics?.viewportHeight) ??
      readPositiveMetric(layoutViewport.clientHeight) ??
      readPositiveMetric(visualViewport.clientHeight) ??
      readPositiveMetric(contentSize.height) ??
      1,
    scale: 1,
  };
}

function readScreenshotViewport(metrics, pageMetrics) {
  const layoutViewport = metrics?.cssLayoutViewport ?? metrics?.layoutViewport ?? {};
  const visualViewport = metrics?.cssVisualViewport ?? metrics?.visualViewport ?? {};
  const contentSize = metrics?.cssContentSize ?? metrics?.contentSize ?? {};
  return {
    width: readPositiveMetric(pageMetrics?.viewportWidth) ??
      readPositiveMetric(layoutViewport.clientWidth) ??
      readPositiveMetric(visualViewport.clientWidth) ??
      readPositiveMetric(contentSize.width) ??
      1,
    height: readPositiveMetric(pageMetrics?.viewportHeight) ??
      readPositiveMetric(layoutViewport.clientHeight) ??
      readPositiveMetric(visualViewport.clientHeight) ??
      readPositiveMetric(contentSize.height) ??
      1,
  };
}

function readFiniteMetric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readPositiveMetric(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;
  await new Promise((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function installConsoleHook(tabId) {
  await executeMainWorldScript(tabId, () => {
    if (globalThis.__backchatConsoleHookInstalled) return null;
    const logs = [];
    Object.defineProperty(globalThis, "__backchatConsoleHookInstalled", {
      value: true,
      configurable: false,
    });
    Object.defineProperty(globalThis, "__backchatConsoleLogs", {
      value: logs,
      configurable: false,
    });
    const formatArg = (value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };
    for (const level of ["debug", "info", "log", "warn", "error"]) {
      const original = typeof console[level] === "function"
        ? console[level].bind(console)
        : console.log.bind(console);
      console[level] = (...args) => {
        logs.push({
          level,
          message: args.map(formatArg).join(" "),
          timestamp: new Date().toISOString(),
          url: location.href,
        });
        return original(...args);
      };
    }
    return null;
  });
}

async function readConsoleLogs(tabId) {
  return executeMainWorldScript(tabId, () => {
    return Array.isArray(globalThis.__backchatConsoleLogs)
      ? globalThis.__backchatConsoleLogs.slice()
      : [];
  });
}

async function ensureDebuggerAttached(tabId) {
  if (debuggerTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!message.includes("Another debugger is already attached")) {
      throw error;
    }
    throw new Error(
      "Chrome debugger is already attached to this tab; close DevTools or other debuggers first",
    );
  }
  debuggerTabs.add(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Page.enable");
}

async function detachDebugger(tabId) {
  if (!debuggerTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // The tab may already be closing.
  } finally {
    debuggerTabs.delete(tabId);
    dialogsByTabId.delete(tabId);
    dialogWaitersByTabId.delete(tabId);
  }
}

async function handleJavaScriptDialog(tabId, accept, promptText) {
  await ensureDebuggerAttached(tabId);
  const dialog = dialogsByTabId.get(tabId);
  if (!dialog) throw new Error("No JavaScript dialog is active");
  await chrome.debugger.sendCommand(
    { tabId },
    "Page.handleJavaScriptDialog",
    {
      accept,
      ...(promptText !== undefined ? { promptText } : {}),
    },
  );
  dialogsByTabId.delete(tabId);
}

async function dispatchMouseClick(tabId, point) {
  if (
    !point ||
    typeof point.x !== "number" ||
    typeof point.y !== "number" ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    throw new Error("Click target did not resolve to finite coordinates");
  }
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  const release = chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  const first = await Promise.race([
    release.then(
      () => ({ type: "released" }),
      (error) => ({ type: "error", error }),
    ),
    waitForDialogOpen(tabId, 1_000).then((opened) =>
      opened ? { type: "dialog" } : { type: "no-dialog-yet" }
    ),
  ]);
  if (first.type === "dialog") {
    release.catch(() => undefined);
    return;
  }
  if (first.type === "error") {
    throw first.error;
  }
  await release;
}

function waitForDialogOpen(tabId, timeoutMs) {
  if (dialogsByTabId.has(tabId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const waiter = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      const waiters = dialogWaitersByTabId.get(tabId) ?? [];
      const next = waiters.filter((candidate) => candidate !== waiter);
      if (next.length > 0) dialogWaitersByTabId.set(tabId, next);
      else dialogWaitersByTabId.delete(tabId);
    };
    const waiters = dialogWaitersByTabId.get(tabId) ?? [];
    waiters.push(waiter);
    dialogWaitersByTabId.set(tabId, waiters);
  });
}

function resolveDialogWaiters(tabId) {
  const waiters = dialogWaitersByTabId.get(tabId) ?? [];
  dialogWaitersByTabId.delete(tabId);
  for (const waiter of waiters) waiter();
}

function normalizeDialogType(value) {
  return value === "alert" ||
    value === "confirm" ||
    value === "prompt" ||
    value === "beforeunload"
    ? value
    : "alert";
}

async function executeDomCuaScript(tabId, operation, operationArgs = []) {
  return executeScript(tabId, (operation, operationArgs) => {
    const normalizeDomCuaText = (value) =>
      String(value ?? "").replace(/\s+/g, " ").trim();
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
      const attrs = [`node_id="${String(index + 1)}"`];
      const label = domCuaLabel(element);
      if (label) attrs.push(`aria-label="${escapeDomCuaAttr(label)}"`);
      if ("value" in element && element.value) {
        attrs.push(`value="${escapeDomCuaAttr(element.value)}"`);
      }
      return `<${domCuaTag(element)} ${attrs.join(" ")}>` +
        escapeDomCuaText(domCuaText(element)) +
        `</${domCuaTag(element)}>`;
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

    if (operation === "snapshot") {
      return domCuaElements().map(domCuaMarkup).join("\n");
    }
    if (operation === "click") {
      const element = domCuaElementByNodeId(operationArgs[0]);
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      return null;
    }
    if (operation === "centerPoint") {
      const element = domCuaElementByNodeId(operationArgs[0]);
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
    throw new Error(`Unsupported DOM CUA operation: ${operation}`);
  }, [operation, operationArgs]);
}

async function executeLocatorScript(tabId, locator, operation, operationArgs = []) {
  if (locator?.kind === "frame") {
    return executeFrameLocatorScript(tabId, 0, locator, operation, operationArgs);
  }
  return executeLocatorOperationInFrame(tabId, 0, locator, operation, operationArgs);
}

async function executeFrameLocatorScript(tabId, parentFrameId, locator, operation, operationArgs = []) {
  const { frameId: childFrameId } = await resolveChildFrameTarget(tabId, parentFrameId, locator.frame);
  if (locator.locator?.kind === "frame") {
    return executeFrameLocatorScript(tabId, childFrameId, locator.locator, operation, operationArgs);
  }
  return executeLocatorOperationInFrame(tabId, childFrameId, locator.locator, operation, operationArgs);
}

async function resolveLocatorClickPoint(tabId, locator) {
  if (locator?.kind === "frame") {
    return resolveFrameLocatorClickPoint(tabId, 0, locator, { x: 0, y: 0 });
  }
  return readViewportPoint(
    await executeLocatorOperationInFrame(tabId, 0, locator, "centerPoint"),
    "Locator click target did not resolve to viewport coordinates",
  );
}

async function resolveFrameLocatorClickPoint(tabId, parentFrameId, locator, origin) {
  const child = await resolveChildFrameTarget(tabId, parentFrameId, locator.frame);
  const childOrigin = {
    x: origin.x + child.offset.x,
    y: origin.y + child.offset.y,
  };
  if (locator.locator?.kind === "frame") {
    return resolveFrameLocatorClickPoint(tabId, child.frameId, locator.locator, childOrigin);
  }
  const point = readViewportPoint(
    await executeLocatorOperationInFrame(tabId, child.frameId, locator.locator, "centerPoint"),
    "Frame locator click target did not resolve to viewport coordinates",
  );
  return {
    x: childOrigin.x + point.x,
    y: childOrigin.y + point.y,
  };
}

async function resolveChildFrameTarget(tabId, parentFrameId, frameLocator) {
  const descriptor = await readFrameDescriptor(tabId, parentFrameId, frameLocator);
  const offset = readViewportPoint(
    descriptor,
    "Frame locator target did not resolve to viewport coordinates",
  );

  const candidates = await resolveChildFrameCandidates(tabId, parentFrameId, descriptor.url);
  if (candidates.length === 1 && typeof candidates[0].frameId === "number") {
    return { frameId: candidates[0].frameId, offset };
  }
  if (candidates.length === 0) {
    throw new Error(`Frame locator target is not available: ${descriptor.url}`);
  }
  const sameUrlIndex = readFrameDescriptorSameUrlIndex(descriptor);
  if (sameUrlIndex !== null && candidates[sameUrlIndex]) {
    return { frameId: candidates[sameUrlIndex].frameId, offset };
  }
  throw new Error(
    `Frame locator target is ambiguous for ${descriptor.url}; ` +
    "use a locator.index that selects a unique frame element",
  );
}

async function readFrameDescriptor(tabId, parentFrameId, frameLocator) {
  let lastDescriptor = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    lastDescriptor = await executeLocatorOperationInFrame(
      tabId,
      parentFrameId,
      frameLocator,
      "frameDescriptor",
    );
    if (lastDescriptor && typeof lastDescriptor.url === "string") {
      return lastDescriptor;
    }
    await delay(100);
  }
  throw new Error(
    "Frame locator target did not resolve to a navigable frame: " +
    JSON.stringify(lastDescriptor),
  );
}

function readFrameDescriptorSameUrlIndex(descriptor) {
  const value = descriptor.sameUrlIndex;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

async function resolveChildFrameCandidates(tabId, parentFrameId, url) {
  if (chrome.webNavigation?.getAllFrames) {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      const candidates = (frames ?? [])
        .filter((frame) =>
          typeof frame.frameId === "number" &&
          frame.parentFrameId === parentFrameId &&
          frame.url === url
        )
        .sort((a, b) => a.frameId - b.frameId);
      if (candidates.length > 0) return candidates;
    } catch {
      // Fall back to chrome.scripting below for older or restricted builds.
    }
  }
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => ({
      href: location.href,
    }),
  });
  return frames
    .filter((entry) => entry.frameId !== parentFrameId)
    .filter((entry) => entry.result?.href === url)
    .sort((a, b) => a.frameId - b.frameId);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readViewportPoint(value, message) {
  if (
    value &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  ) {
    return { x: value.x, y: value.y };
  }
  throw new Error(message);
}

async function executeLocatorOperationInFrame(tabId, frameId, locator, operation, operationArgs = []) {
  return executeScriptInFrame(tabId, frameId, (locator, operation, operationArgs) => {
    const normalizeLocatorText = (value) =>
      String(value ?? "").replace(/\s+/g, " ").trim();
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
      const matched = elements.filter((element) =>
        isLocatorVisible(element) && predicate(element)
      );
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
          .split(/\s+/)
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
    const resolveBackchatLocator = (locator, rootDocument = document) => {
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
        const frame = targetBackchatLocatorElement(resolveBackchatLocator(locator.frame, rootDocument), locator.frame);
        const frameDocument = frame.contentDocument;
        if (!frameDocument) {
          throw new Error("Frame locator target is not accessible");
        }
        return resolveBackchatLocator(locator.locator, frameDocument);
      }
      throw new Error("Unsupported locator kind: " + String(locator.kind));
    };
    const locatorTargetIndex = (locator) => {
      if (!locator || locator.index === undefined) return null;
      if (!Number.isInteger(locator.index) || locator.index < 0) {
        throw new Error("locator.index must be a non-negative integer");
      }
      return locator.index;
    };
    const targetBackchatLocatorElement = (elements, locator) => {
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
    };
    const resolveFrameUrl = (frameElement) => {
      try {
        if (frameElement.hasAttribute("srcdoc")) {
          return "about:srcdoc";
        }
        const src = frameElement.getAttribute("src");
        if (src) {
          return new URL(src, document.baseURI).href;
        }
        if (frameElement.src) {
          return String(frameElement.src);
        }
        if (frameElement.contentWindow?.location?.href) {
          return String(frameElement.contentWindow.location.href);
        }
      } catch {
        if (frameElement.src) {
          return String(frameElement.src);
        }
      }
      return "about:blank";
    };

    const elements = resolveBackchatLocator(locator);
    if (operation === "count") return elements.length;
    const element = targetBackchatLocatorElement(elements, locator);
    if (operation === "frameDescriptor") {
      const tagName = String(element.tagName || "").toLowerCase();
      if (tagName !== "iframe" && tagName !== "frame") {
        throw new Error("Frame locator target is not a frame");
      }
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      const url = resolveFrameUrl(element);
      const sameUrlSiblings = Array.from(document.querySelectorAll("iframe, frame"))
        .filter((candidate) => resolveFrameUrl(candidate) === url);
      return {
        url,
        sameUrlIndex: sameUrlSiblings.indexOf(element),
        x: rect.left + (element.clientLeft || 0),
        y: rect.top + (element.clientTop || 0),
      };
    }
    if (operation === "innerText") {
      return element.innerText || element.textContent || "";
    }
    if (operation === "attribute") {
      return element.getAttribute(operationArgs[0]);
    }
    if (operation === "click") {
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      return null;
    }
    if (operation === "centerPoint") {
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
    if (operation === "fill") {
      const text = operationArgs[0];
      element.focus();
      if ("value" in element) {
        element.value = text;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        element.textContent = text;
        element.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        }));
      }
      return null;
    }
    if (operation === "press") {
      const key = operationArgs[0];
      element.focus();
      for (const type of ["keydown", "keyup"]) {
        element.dispatchEvent(new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          key,
        }));
      }
      return null;
    }
    if (operation === "setChecked") {
      if (!("checked" in element)) {
        throw new Error("Locator target is not checkable");
      }
      element.checked = operationArgs[0] === true;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return null;
    }
    if (operation === "selectOption") {
      if (String(element.tagName || "").toLowerCase() !== "select") {
        throw new Error("Locator target is not a select element");
      }
      const values = operationArgs[0];
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
    throw new Error(`Unsupported locator operation: ${operation}`);
  }, [locator, operation, operationArgs]);
}
