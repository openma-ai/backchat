import type { BrowserDescriptor } from "@shared/browser-plugin";

export const CHROME_EXTENSION_LOAD_PATH = "packages/browser-extension";

export const CHROME_EXTENSION_REQUIRED_PERMISSIONS = [
  "activeTab",
  "tabs",
  "scripting",
  "debugger",
  "webNavigation",
  "<all_urls>",
] as const;

export type BrowserSettingsStatus =
  | "available"
  | "connected"
  | "error"
  | "waiting"
  | "unavailable";

export interface BrowserSettingsRow {
  label: string;
  value: string;
}

export interface BrowserSettingsBackend {
  status: BrowserSettingsStatus;
  statusLabel: string;
  summary: string;
  rows: BrowserSettingsRow[];
  loadPath?: string;
  requiredPermissions?: readonly string[];
}

export interface BrowserSettingsModel {
  inApp: BrowserSettingsBackend;
  extension: BrowserSettingsBackend;
}

export function deriveBrowserSettingsModel(
  browsers: BrowserDescriptor[],
): BrowserSettingsModel {
  const inApp = browsers.find((browser) => browser.type === "iab");
  const extension = browsers.find((browser) => browser.type === "extension");

  return {
    inApp: deriveInAppBrowser(inApp),
    extension: deriveChromeExtension(extension),
  };
}

function deriveInAppBrowser(browser: BrowserDescriptor | undefined): BrowserSettingsBackend {
  if (!browser) {
    return {
      status: "unavailable",
      statusLabel: "Unavailable",
      summary: "The in-app browser backend has not been registered.",
      rows: [{ label: "Backend", value: "Electron in-app browser" }],
    };
  }

  const capabilityCount = browser.capabilities.browser.length + browser.capabilities.tab.length;
  return {
    status: "available",
    statusLabel: "Available",
    summary: "Backchat can open and inspect its embedded browser rail.",
    rows: [
      { label: "Backend", value: "Electron in-app browser" },
      { label: "Capabilities", value: String(capabilityCount) },
    ],
  };
}

function deriveChromeExtension(browser: BrowserDescriptor | undefined): BrowserSettingsBackend {
  const metadata = browser?.metadata ?? {};
  const bridgePort = metadata["bridgePort"] || "29174";
  const extensionId = metadata["extensionId"];
  const bridgeStatus = metadata["bridgeStatus"];

  if (!browser) {
    return {
      status: "unavailable",
      statusLabel: "Unavailable",
      summary: "The Chrome extension backend has not been registered in Backchat.",
      loadPath: CHROME_EXTENSION_LOAD_PATH,
      requiredPermissions: CHROME_EXTENSION_REQUIRED_PERMISSIONS,
      rows: [
        { label: "Bridge port", value: bridgePort },
        { label: "Extension path", value: CHROME_EXTENSION_LOAD_PATH },
      ],
    };
  }

  if (!extensionId) {
    return {
      status: "waiting",
      statusLabel: "Waiting for extension",
      summary: "Load the unpacked extension and leave automation allowed in its popup.",
      loadPath: CHROME_EXTENSION_LOAD_PATH,
      requiredPermissions: CHROME_EXTENSION_REQUIRED_PERMISSIONS,
      rows: [
        { label: "Bridge port", value: bridgePort },
        { label: "Extension path", value: CHROME_EXTENSION_LOAD_PATH },
      ],
    };
  }

  if (extensionId && isBridgeErrorStatus(bridgeStatus)) {
    return {
      status: "error",
      statusLabel: bridgeStatus === "command-timeout" ? "Command timeout" : "Command error",
      summary: "The Chrome extension bridge is registered, but the last command failed.",
      rows: compactRows([
        { label: "Bridge port", value: bridgePort },
        { label: "Bridge status", value: bridgeStatus },
        { label: "Extension ID", value: extensionId },
        { label: "Version", value: metadata["extensionVersion"] },
        { label: "Profile", value: metadata["profileName"] },
        { label: "Instance", value: metadata["instanceId"] },
        { label: "Last connected", value: metadata["bridgeLastConnectedAt"] },
        { label: "Last command", value: metadata["bridgeLastCommandType"] },
        { label: "Last error", value: metadata["bridgeLastError"] },
        { label: "Pending", value: metadata["bridgePendingCommands"] },
        { label: "Queued", value: metadata["bridgeQueuedCommands"] },
      ]),
    };
  }

  return {
    status: "connected",
    statusLabel: "Connected",
    summary: "Chrome tabs are available to Backchat tools.",
    rows: compactRows([
      { label: "Bridge port", value: bridgePort },
      { label: "Bridge status", value: bridgeStatus },
      { label: "Extension ID", value: extensionId },
      { label: "Version", value: metadata["extensionVersion"] },
      { label: "Profile", value: metadata["profileName"] },
      { label: "Instance", value: metadata["instanceId"] },
      { label: "Last connected", value: metadata["bridgeLastConnectedAt"] },
      { label: "Last command", value: metadata["bridgeLastCommandType"] },
      { label: "Pending", value: metadata["bridgePendingCommands"] },
      { label: "Queued", value: metadata["bridgeQueuedCommands"] },
    ]),
  };
}

function isBridgeErrorStatus(status: string | undefined): status is "command-error" | "command-timeout" {
  return status === "command-error" || status === "command-timeout";
}

function compactRows(
  rows: Array<{ label: string; value: string | undefined }>,
): BrowserSettingsRow[] {
  return rows.flatMap((row) => row.value ? [{ label: row.label, value: row.value }] : []);
}
