import type {
  BrowserElementHoverInfo,
  BrowserElementPickResult,
  BrowserRegionPickResult,
} from "../shared/browser-element-picker.js";
import type { BrowserElementAnnotationDetails } from "../shared/session-events.js";
import { describeBrowserNodeAtPoint } from "./browser-node-hit-test.js";

interface CdpDebuggerLike {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: "detach", listener: (...args: unknown[]) => void): unknown;
  off(event: "detach", listener: (...args: unknown[]) => void): unknown;
}

async function cdpCommand(
  target: BrowserElementPickerTarget,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await target.debugger.sendCommand(method, params);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${method}: ${detail}`);
  }
}

export interface BrowserElementPickerTarget {
  readonly id: number;
  readonly debugger: CdpDebuggerLike;
  isDestroyed(): boolean;
  isLoading(): boolean;
  isLoadingMainFrame?(): boolean;
  getURL(): string;
  getTitle(): string;
  on(
    event: "did-start-navigation" | "destroyed",
    listener: (...args: unknown[]) => void,
  ): unknown;
  off(
    event: "did-start-navigation" | "destroyed",
    listener: (...args: unknown[]) => void,
  ): unknown;
}

interface LayoutViewport {
  pageX: number;
  pageY: number;
  clientWidth: number;
  clientHeight: number;
}

interface HoverRecord extends BrowserElementHoverInfo {
  backendNodeId: number;
  frameId: string;
}

interface PickerSession {
  target: BrowserElementPickerTarget;
  hover: HoverRecord | null;
  layout: LayoutViewport | null;
  requestVersion: number;
  closing: boolean;
  onNavigate: (...args: unknown[]) => void;
  onDestroyed: () => void;
  onDebuggerDetach: (...args: unknown[]) => void;
}

type BrowserElementPick = Omit<BrowserElementAnnotationDetails, "screenshot_name">;

const EXTRACT_ELEMENT_FUNCTION = String.raw`function () {
  const element = this;
  const doc = element.ownerDocument;
  const view = doc.defaultView || window;
  const truncate = (value, max) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max - 1) + "..." : text;
  };
  const escapeCss = (value) => {
    try { return view.CSS.escape(value); }
    catch { return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
  };
  const segmentFor = (node) => {
    if (node.id) return "#" + escapeCss(node.id);
    const testId = node.getAttribute("data-testid");
    if (testId) return '[data-testid="' + escapeCss(testId) + '"]';
    let segment = node.tagName.toLowerCase();
    const classes = Array.from(node.classList)
      .filter((name) => name.length > 0 && name.length <= 48)
      .slice(0, 2);
    if (classes.length > 0) {
      segment += classes.map((name) => "." + escapeCss(name)).join("");
    }
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (sibling) => sibling.tagName === node.tagName,
      );
      if (siblings.length > 1) {
        segment += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
    }
    return segment;
  };
  const selectorWithinRoot = (start) => {
    const parts = [];
    let node = start;
    while (node && node.nodeType === 1) {
      parts.unshift(segmentFor(node));
      if (node.id || node.hasAttribute("data-testid")) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const selectorFor = (start) => {
    const sections = [];
    let node = start;
    while (node && node.nodeType === 1) {
      sections.unshift(selectorWithinRoot(node));
      const root = node.getRootNode();
      node = root && root.host ? root.host : null;
    }
    return sections.filter(Boolean).join(" >>> ") || start.tagName.toLowerCase();
  };
  const domPathFor = (start) => {
    const parts = [];
    let node = start;
    while (node && node.nodeType === 1 && node !== doc.documentElement) {
      parts.unshift(node.tagName.toLowerCase());
      node = node.parentElement;
    }
    if (node === doc.documentElement) parts.unshift("html");
    return parts.join(" > ");
  };

  const blockedAttributes = new Set(["value", "srcdoc", "nonce", "integrity"]);
  const attributes = {};
  for (const attribute of Array.from(element.attributes).slice(0, 24)) {
    if (blockedAttributes.has(attribute.name.toLowerCase())) continue;
    attributes[attribute.name] = truncate(attribute.value, 300);
  }
  const clone = element.cloneNode(true);
  if (clone instanceof view.HTMLElement) {
    const formNodes = [clone, ...clone.querySelectorAll("input, textarea, select, option")];
    for (const formNode of formNodes) {
      formNode.removeAttribute("value");
      formNode.removeAttribute("checked");
      formNode.removeAttribute("selected");
    }
  }
  const isPassword = element instanceof view.HTMLInputElement && element.type === "password";
  const text = isPassword ? "" : truncate(element.innerText || element.textContent, 1200);
  const rect = element.getBoundingClientRect();
  const computed = view.getComputedStyle(element);
  const computedStyles = {
    color: computed.color,
    background: computed.backgroundColor,
    opacity: computed.opacity,
    "font-family": computed.fontFamily,
    "font-size": computed.fontSize,
    "font-weight": computed.fontWeight,
    "line-height": computed.lineHeight,
    "border-radius": computed.borderRadius,
  };
  return {
    url: truncate(view.location.href, 2048),
    title: truncate(doc.title, 300),
    selector: selectorFor(element),
    dom_path: domPathFor(element),
    tag_name: element.tagName.toLowerCase(),
    ...(element.id ? { id: truncate(element.id, 200) } : {}),
    class_names: Array.from(element.classList).slice(0, 16).map((name) => truncate(name, 120)),
    ...(element.getAttribute("role") ? { role: truncate(element.getAttribute("role"), 120) } : {}),
    ...(element.getAttribute("aria-label") ? { aria_label: truncate(element.getAttribute("aria-label"), 300) } : {}),
    ...(text ? { text } : {}),
    attributes,
    ...(clone instanceof view.HTMLElement ? { outer_html: truncate(clone.outerHTML, 4000) } : {}),
    computed_styles: computedStyles,
    rect: {
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    },
    viewport: {
      width: view.innerWidth,
      height: view.innerHeight,
      device_pixel_ratio: view.devicePixelRatio || 1,
    },
  };
}`;

const DRAW_CAPTURE_MARKER_FUNCTION = String.raw`function (labelText) {
  const doc = this.ownerDocument;
  const view = doc.defaultView || window;
  doc.getElementById("__backchat-cdp-capture-overlay")?.remove();
  const rect = this.getBoundingClientRect();
  const box = doc.createElement("div");
  box.id = "__backchat-cdp-capture-overlay";
  Object.assign(box.style, {
    position: "fixed",
    left: rect.left + "px",
    top: rect.top + "px",
    width: rect.width + "px",
    height: rect.height + "px",
    zIndex: "2147483646",
    pointerEvents: "none",
    border: "2px solid #3b82f6",
    background: "rgba(59,130,246,.16)",
    borderRadius: "4px",
    boxSizing: "border-box",
    boxShadow: "0 0 0 1px rgba(255,255,255,.85), 0 4px 12px rgba(15,17,21,.20)",
  });
  const marker = doc.createElement("span");
  marker.textContent = "1";
  Object.assign(marker.style, {
    position: "absolute",
    right: "-11px",
    top: "-11px",
    display: "grid",
    placeItems: "center",
    width: "22px",
    height: "22px",
    borderRadius: "999px",
    background: "#3b82f6",
    color: "white",
    border: "2px solid white",
    font: "600 12px/1 -apple-system, BlinkMacSystemFont, sans-serif",
    boxShadow: "0 2px 8px rgba(15,17,21,.25)",
  });
  box.append(marker);
  const label = doc.createElement("div");
  label.textContent = labelText;
  Object.assign(label.style, {
    position: "fixed",
    left: Math.max(8, Math.min(rect.left, view.innerWidth - 428)) + "px",
    top: Math.max(8, rect.top >= 34 ? rect.top - 30 : Math.min(view.innerHeight - 30, rect.bottom + 6)) + "px",
    zIndex: "2147483647",
    pointerEvents: "none",
    maxWidth: "min(420px, calc(100vw - 16px))",
    padding: "5px 7px",
    borderRadius: "5px",
    color: "white",
    background: "rgba(15,17,21,.92)",
    font: "500 11px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    boxShadow: "0 3px 12px rgba(15,17,21,.25)",
  });
  (doc.body || doc.documentElement).append(box, label);
  box.dataset.labelId = "__backchat-cdp-capture-label";
  label.id = "__backchat-cdp-capture-label";
  return new Promise((resolve) => {
    view.requestAnimationFrame(() => {
      view.requestAnimationFrame(() => resolve(true));
    });
  });
}`;

const CLEAR_CAPTURE_MARKER_FUNCTION = String.raw`function () {
  const doc = this.ownerDocument;
  doc.getElementById("__backchat-cdp-capture-overlay")?.remove();
  doc.getElementById("__backchat-cdp-capture-label")?.remove();
  return true;
}`;

const CLEAR_REGION_CAPTURE_EXPRESSION = String.raw`(() => {
  document.getElementById("__backchat-cdp-region-overlay")?.remove();
  return true;
})()`;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function cssEscape(value: string): string {
  return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (part) => `\\${part}`);
}

function attributeRecord(attributes: unknown): Record<string, string> {
  if (!Array.isArray(attributes)) return {};
  const result: Record<string, string> = {};
  for (let index = 0; index + 1 < attributes.length; index += 2) {
    const name = attributes[index];
    const value = attributes[index + 1];
    if (typeof name === "string" && typeof value === "string") result[name] = value;
  }
  return result;
}

function hoverSelector(tagName: string, attributes: Record<string, string>): string {
  if (attributes.id) return `#${cssEscape(attributes.id)}`;
  if (attributes["data-testid"]) {
    return `[data-testid="${cssEscape(attributes["data-testid"])}"]`;
  }
  const classes = (attributes.class || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => `.${cssEscape(name)}`)
    .join("");
  return `${tagName || "element"}${classes}`;
}

function rectFromBorderQuad(
  border: unknown,
  layout: LayoutViewport,
): BrowserElementHoverInfo["rect"] | null {
  if (!Array.isArray(border) || border.length < 8) return null;
  const xs = [finite(border[0]), finite(border[2]), finite(border[4]), finite(border[6])];
  const ys = [finite(border[1]), finite(border[3]), finite(border[5]), finite(border[7])];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    x: rounded(left - layout.pageX),
    y: rounded(top - layout.pageY),
    width: rounded(right - left),
    height: rounded(bottom - top),
  };
}

function normalizeRegion(
  input: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
): BrowserElementHoverInfo["rect"] {
  const rawLeft = Math.min(input.x, input.x + input.width);
  const rawRight = Math.max(input.x, input.x + input.width);
  const rawTop = Math.min(input.y, input.y + input.height);
  const rawBottom = Math.max(input.y, input.y + input.height);
  const left = Math.max(0, Math.min(viewport.width, rawLeft));
  const right = Math.max(0, Math.min(viewport.width, rawRight));
  const top = Math.max(0, Math.min(viewport.height, rawTop));
  const bottom = Math.max(0, Math.min(viewport.height, rawBottom));
  return {
    x: rounded(left),
    y: rounded(top),
    width: rounded(Math.max(0, right - left)),
    height: rounded(Math.max(0, bottom - top)),
  };
}

function drawRegionCaptureExpression(
  rect: BrowserElementHoverInfo["rect"],
): string {
  const serialized = JSON.stringify(rect);
  return String.raw`(() => {
    document.getElementById("__backchat-cdp-region-overlay")?.remove();
    const rect = ${serialized};
    const box = document.createElement("div");
    box.id = "__backchat-cdp-region-overlay";
    Object.assign(box.style, {
      position: "fixed",
      left: rect.x + "px",
      top: rect.y + "px",
      width: rect.width + "px",
      height: rect.height + "px",
      zIndex: "2147483647",
      pointerEvents: "none",
      border: "2px dashed #3b82f6",
      background: "rgba(59,130,246,.16)",
      boxSizing: "border-box",
    });
    const marker = document.createElement("span");
    marker.textContent = "1";
    Object.assign(marker.style, {
      position: "absolute",
      right: "-11px",
      bottom: "-11px",
      display: "grid",
      placeItems: "center",
      width: "22px",
      height: "22px",
      borderRadius: "999px",
      background: "#3b82f6",
      color: "white",
      border: "2px solid white",
      font: "600 12px/1 -apple-system, BlinkMacSystemFont, sans-serif",
      boxShadow: "0 2px 8px rgba(15,17,21,.24)",
    });
    box.append(marker);
    (document.body || document.documentElement).append(box);
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        devicePixelRatio: window.devicePixelRatio || 1,
      })));
    });
  })()`;
}

export class BrowserElementPickerService {
  readonly #sessions = new Map<number, PickerSession>();

  async begin(target: BrowserElementPickerTarget): Promise<void> {
    await this.cancel(target.id);
    if (target.isDestroyed()) throw new Error("Browser view is unavailable");
    const isMainFrameLoading = target.isLoadingMainFrame?.() ?? target.isLoading();
    if (isMainFrameLoading) throw new Error("Browser page is still loading");
    if (target.debugger.isAttached()) {
      throw new Error("Browser debugger is already attached");
    }

    target.debugger.attach("1.3");
    const onNavigate = (...args: unknown[]): void => {
      const isMainFrame = args[3];
      if (isMainFrame === false) return;
      void this.cancel(target.id);
    };
    const onDestroyed = (): void => {
      void this.cancel(target.id);
    };
    const onDebuggerDetach = (): void => {
      this.#drop(target.id);
    };
    const session: PickerSession = {
      target,
      hover: null,
      layout: null,
      requestVersion: 0,
      closing: false,
      onNavigate,
      onDestroyed,
      onDebuggerDetach,
    };
    this.#sessions.set(target.id, session);
    target.on("did-start-navigation", onNavigate);
    target.on("destroyed", onDestroyed);
    target.debugger.on("detach", onDebuggerDetach);

    try {
      await target.debugger.sendCommand("DOM.enable");
      await target.debugger.sendCommand("Page.enable");
      await target.debugger.sendCommand("Runtime.enable");
    } catch (error) {
      await this.cancel(target.id);
      throw error;
    }
  }

  async hover(
    webContentsId: number,
    point: { x: number; y: number },
  ): Promise<BrowserElementHoverInfo | null> {
    const session = this.#active(webContentsId);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("Browser pointer coordinates are invalid");
    }
    const requestVersion = ++session.requestVersion;
    const layoutResponse = asRecord(
      await cdpCommand(session.target, "Page.getLayoutMetrics"),
    );
    const layoutRaw = asRecord(layoutResponse.cssLayoutViewport);
    const layout: LayoutViewport = {
      pageX: finite(layoutRaw.pageX) ?? 0,
      pageY: finite(layoutRaw.pageY) ?? 0,
      clientWidth: finite(layoutRaw.clientWidth) ?? 0,
      clientHeight: finite(layoutRaw.clientHeight) ?? 0,
    };
    if (layout.clientWidth <= 0 || layout.clientHeight <= 0) {
      throw new Error("Browser page viewport is not ready");
    }
    const x = Math.max(0, Math.min(layout.clientWidth - 1, point.x));
    const y = Math.max(0, Math.min(layout.clientHeight - 1, point.y));
    const hitPoint = {
      x: Math.round(x),
      y: Math.round(y),
    };
    const hit = await describeBrowserNodeAtPoint(
      session.target.debugger,
      hitPoint,
    );
    if (!hit) {
      if (requestVersion === session.requestVersion) session.hover = null;
      return null;
    }
    const node = hit.node;
    const backendNodeId = finite(node.backendNodeId);
    if (!backendNodeId) {
      if (requestVersion === session.requestVersion) session.hover = null;
      return null;
    }

    const boxResponse = await cdpCommand(session.target, "DOM.getBoxModel", {
      backendNodeId,
    });
    if (requestVersion !== session.requestVersion || session.closing) return null;
    const model = asRecord(asRecord(boxResponse).model);
    const rect = rectFromBorderQuad(model.border, layout);
    if (!rect) return null;
    const tagName = String(node.localName || node.nodeName || "element").toLowerCase();
    const selector = hoverSelector(tagName, attributeRecord(node.attributes));
    const hover: HoverRecord = {
      backendNodeId,
      frameId: hit.frameId,
      selector,
      tag_name: tagName,
      rect,
      label: `${selector}  ${Math.round(rect.width)}x${Math.round(rect.height)}`,
    };
    session.layout = layout;
    session.hover = hover;
    return {
      selector: hover.selector,
      tag_name: hover.tag_name,
      rect: hover.rect,
      label: hover.label,
    };
  }

  async commit(webContentsId: number): Promise<BrowserElementPickResult | null> {
    const session = this.#active(webContentsId);
    const hover = session.hover;
    if (!hover) return null;
    session.closing = true;
    const debuggerApi = session.target.debugger;
    let objectId: string | null = null;
    let markerDrawn = false;
    try {
      const isolatedWorld = hover.frameId
        ? asRecord(await debuggerApi.sendCommand("Page.createIsolatedWorld", {
            frameId: hover.frameId,
            worldName: "backchat-browser-annotation",
            grantUniveralAccess: false,
          }).catch(() => ({})))
        : {};
      const executionContextId = finite(isolatedWorld.executionContextId);
      const resolved = asRecord(
        await debuggerApi.sendCommand("DOM.resolveNode", {
          backendNodeId: hover.backendNodeId,
          ...(executionContextId ? { executionContextId } : {}),
        }),
      );
      objectId = String(asRecord(resolved.object).objectId || "");
      if (!objectId) throw new Error("Selected browser element is no longer available");

      const extraction = asRecord(
        await debuggerApi.sendCommand("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: EXTRACT_ELEMENT_FUNCTION,
          returnByValue: true,
        }),
      );
      const extracted = asRecord(asRecord(extraction.result).value) as BrowserElementPick;
      if (!extracted.selector || !extracted.tag_name) {
        throw new Error("Selected browser element could not be serialized");
      }
      const layout = session.layout;
      const element: BrowserElementPick = {
        ...extracted,
        rect: hover.rect,
        viewport: layout
          ? {
              width: layout.clientWidth,
              height: layout.clientHeight,
              device_pixel_ratio: finite(extracted.viewport?.device_pixel_ratio, 1),
            }
          : extracted.viewport,
      };

      await debuggerApi.sendCommand("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: DRAW_CAPTURE_MARKER_FUNCTION,
        arguments: [{ value: hover.label }],
        returnByValue: true,
        awaitPromise: true,
      });
      markerDrawn = true;
      const capture = asRecord(
        await debuggerApi.sendCommand("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        }),
      );
      const screenshotData = typeof capture.data === "string" ? capture.data : "";
      if (!screenshotData) throw new Error("Browser page screenshot was empty");
      return { element, screenshotData };
    } finally {
      if (objectId && markerDrawn && debuggerApi.isAttached()) {
        await debuggerApi.sendCommand("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: CLEAR_CAPTURE_MARKER_FUNCTION,
          returnByValue: true,
        }).catch(() => undefined);
      }
      if (objectId && debuggerApi.isAttached()) {
        await debuggerApi.sendCommand("Runtime.releaseObject", { objectId }).catch(() => undefined);
      }
      await this.cancel(webContentsId);
    }
  }

  async captureRegion(
    webContentsId: number,
    input: { x: number; y: number; width: number; height: number },
  ): Promise<BrowserRegionPickResult> {
    const session = this.#active(webContentsId);
    session.closing = true;
    session.requestVersion += 1;
    const debuggerApi = session.target.debugger;
    let markerDrawn = false;
    let devicePixelRatio = 1;
    try {
      const layoutResponse = asRecord(
        await debuggerApi.sendCommand("Page.getLayoutMetrics"),
      );
      const layoutRaw = asRecord(layoutResponse.cssLayoutViewport);
      const viewport = {
        width: finite(layoutRaw.clientWidth),
        height: finite(layoutRaw.clientHeight),
      };
      const rect = normalizeRegion(input, viewport);
      if (rect.width < 6 || rect.height < 6) {
        throw new Error("Selected browser region is too small");
      }
      const markerResponse = asRecord(await debuggerApi.sendCommand("Runtime.evaluate", {
        expression: drawRegionCaptureExpression(rect),
        returnByValue: true,
        awaitPromise: true,
      }));
      devicePixelRatio = finite(
        asRecord(asRecord(markerResponse.result).value).devicePixelRatio,
        1,
      );
      markerDrawn = true;
      const capture = asRecord(
        await debuggerApi.sendCommand("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        }),
      );
      const screenshotData = typeof capture.data === "string" ? capture.data : "";
      if (!screenshotData) throw new Error("Browser page screenshot was empty");
      return {
        screenshotData,
        region: {
          url: session.target.getURL(),
          title: session.target.getTitle(),
          rect,
          viewport: {
            ...viewport,
            device_pixel_ratio: devicePixelRatio,
          },
        },
      };
    } finally {
      if (markerDrawn && debuggerApi.isAttached()) {
        await debuggerApi.sendCommand("Runtime.evaluate", {
          expression: CLEAR_REGION_CAPTURE_EXPRESSION,
          returnByValue: true,
        }).catch(() => undefined);
      }
      await this.cancel(webContentsId);
    }
  }

  async cancel(webContentsId: number): Promise<void> {
    const session = this.#sessions.get(webContentsId);
    if (!session) return;
    if (session.closing) {
      session.requestVersion += 1;
    }
    this.#sessions.delete(webContentsId);
    session.closing = true;
    session.target.off("did-start-navigation", session.onNavigate);
    session.target.off("destroyed", session.onDestroyed);
    session.target.debugger.off("detach", session.onDebuggerDetach);
    if (session.target.debugger.isAttached()) session.target.debugger.detach();
  }

  #active(webContentsId: number): PickerSession {
    const session = this.#sessions.get(webContentsId);
    if (!session || session.closing) {
      throw new Error("Browser element picker is not active");
    }
    return session;
  }

  #drop(webContentsId: number): void {
    const session = this.#sessions.get(webContentsId);
    if (!session) return;
    this.#sessions.delete(webContentsId);
    session.closing = true;
    session.target.off("did-start-navigation", session.onNavigate);
    session.target.off("destroyed", session.onDestroyed);
    session.target.debugger.off("detach", session.onDebuggerDetach);
  }
}
