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

export interface BrowserPluginStateEvent {
  type: "browser.state";
  browser: BrowserDescriptor;
  visible: boolean;
  activeTabId?: string;
  tabs: BrowserTabInfo[];
}

export interface BrowserGotoParams {
  browser: string;
  tabId: string;
  url: string;
}

export interface BrowserTabParams {
  browser: string;
  tabId: string;
}

export type BrowserLoadState = "domcontentloaded" | "load" | "networkidle";

export interface BrowserWaitForURLParams extends BrowserTabParams {
  url: string;
  waitUntil?: BrowserLoadState;
  timeoutMs?: number;
  pollMs?: number;
}

export interface BrowserWaitForLoadStateParams extends BrowserTabParams {
  state?: BrowserLoadState;
  timeoutMs?: number;
  pollMs?: number;
}

export type BrowserDevLogLevel = "debug" | "info" | "log" | "warn" | "error";

export interface BrowserDevLogEntry {
  level: BrowserDevLogLevel;
  message: string;
  timestamp: string;
  url?: string;
}

export interface BrowserDevLogsParams extends BrowserTabParams {
  pageUrl?: string;
  levels?: BrowserDevLogLevel[];
  filter?: string;
  limit?: number;
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

export interface BrowserSetViewportParams {
  browser: string;
  width: number;
  height: number;
}

export interface BrowserAttachViewParams extends BrowserTabParams {
  bounds: BrowserViewBounds;
  visible?: boolean;
}

export interface BrowserVisibilityParams {
  browser: string;
  visible: boolean;
}

export interface BrowserNameSessionParams {
  browser: string;
  name: string;
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

export interface BrowserLocatorParams extends BrowserTabParams {
  locator: BrowserLocatorDescriptor;
}

export interface BrowserLocatorFillParams extends BrowserLocatorParams {
  text: string;
}

export interface BrowserLocatorPressParams extends BrowserLocatorParams {
  key: string;
}

export interface BrowserLocatorSetCheckedParams extends BrowserLocatorParams {
  checked: boolean;
}

export interface BrowserLocatorSelectOptionParams extends BrowserLocatorParams {
  value: BrowserLocatorSelectValue;
}

export interface BrowserLocatorAttributeParams extends BrowserLocatorParams {
  name: string;
}

export interface BrowserEvaluateParams extends BrowserTabParams {
  expression: string;
}

export interface BrowserClickParams extends BrowserTabParams {
  selector: string;
}

export interface BrowserTypeParams extends BrowserClickParams {
  text: string;
}

export interface BrowserPressParams extends BrowserTabParams {
  key: string;
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

export interface BrowserScreenshotParams extends BrowserTabParams {
  options?: BrowserScreenshotOptions;
}

export interface BrowserCuaClickParams extends BrowserTabParams {
  x: number;
  y: number;
}

export interface BrowserDomCuaClickParams extends BrowserTabParams {
  nodeId: string;
}

export type BrowserDialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export interface BrowserDialogInfo {
  type: BrowserDialogType;
  message: string;
  defaultValue?: string;
}

export interface BrowserDialogAcceptParams extends BrowserTabParams {
  promptText?: string;
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

export interface BrowserScreenshotResult {
  base64: string;
  mimeType: string;
}
