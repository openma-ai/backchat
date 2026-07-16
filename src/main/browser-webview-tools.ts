import { randomUUID } from "node:crypto";

import type { BrowserUiCommand } from "../shared/browser-harness.js";

import {
  BrowserViewRegistry,
  type BrowserViewEntry,
} from "./browser-view-registry.js";

export type { BrowserUiCommand } from "../shared/browser-harness.js";

export type BrowserTabsInput =
  | { action: "list" }
  | { action: "new"; url?: string }
  | { action: "select" | "close"; tab_id?: string; index?: number };

export interface BrowserTabSummary {
  index: number;
  tab_id: string;
  active: boolean;
  url: string;
  title: string;
}

export interface BrowserTabsResult {
  active_tab_id: string | null;
  tabs: BrowserTabSummary[];
}

interface BrowserWebviewToolsOptions {
  requestUi: (command: BrowserUiCommand) => void | Promise<void>;
  createTabId?: () => string;
  uiTimeoutMs?: number;
  registrationGraceMs?: number;
}

const FIND_ELEMENT_SOURCE = `function (selector) {
  const raw = String(selector || "").trim();
  if (!raw) throw new Error("Selector is required");
  if (raw.startsWith("text=")) {
    const text = raw.slice(5).trim();
    return Array.from(document.querySelectorAll("body *")).find((node) =>
      node instanceof HTMLElement && node.innerText.trim() === text
    ) || null;
  }
  const textMatch = raw.match(/^(.*):has-text\\((["'])(.*?)\\2\\)$/);
  if (textMatch) {
    const base = textMatch[1].trim() || "*";
    const text = textMatch[3];
    return Array.from(document.querySelectorAll(base)).find((node) =>
      node instanceof HTMLElement && node.innerText.includes(text)
    ) || null;
  }
  return document.querySelector(raw);
}`;

export class BrowserWebviewTools {
  readonly #registry: BrowserViewRegistry;
  readonly #requestUi: BrowserWebviewToolsOptions["requestUi"];
  readonly #createTabId: () => string;
  readonly #uiTimeoutMs: number;
  readonly #registrationGraceMs: number;

  constructor(registry: BrowserViewRegistry, options: BrowserWebviewToolsOptions) {
    this.#registry = registry;
    this.#requestUi = options.requestUi;
    this.#createTabId = options.createTabId ?? (() => `tab-${randomUUID()}`);
    this.#uiTimeoutMs = options.uiTimeoutMs ?? 5_000;
    this.#registrationGraceMs = Math.min(
      options.registrationGraceMs ?? 300,
      this.#uiTimeoutMs,
    );
  }

  async tabs(sessionId: string, input: BrowserTabsInput): Promise<BrowserTabsResult> {
    if (input.action === "list") return this.#tabState(sessionId);

    if (input.action === "new") {
      const tabId = this.#createTabId();
      const url = normalizeBrowserUrl(input.url ?? "about:blank");
      await this.#requestUi({ action: "open", sessionId, tabId, url });
      await this.#registry.waitForActive(sessionId, tabId, this.#uiTimeoutMs);
      return this.#tabState(sessionId);
    }

    const entry = this.#entryFromInput(sessionId, input);
    if (input.action === "select") {
      await this.#requestUi({ action: "activate", sessionId, tabId: entry.tabId });
      await this.#registry.waitForActive(sessionId, entry.tabId, this.#uiTimeoutMs);
    } else {
      await this.#requestUi({ action: "close", sessionId, tabId: entry.tabId });
      await this.#registry.waitForMissing(sessionId, entry.tabId, this.#uiTimeoutMs);
    }
    return this.#tabState(sessionId);
  }

  async navigate(sessionId: string, rawUrl: string): Promise<Record<string, unknown>> {
    const url = normalizeBrowserUrl(rawUrl);
    let entry = this.#registry.active(sessionId);
    if (!entry && this.#registrationGraceMs > 0) {
      try {
        entry = await this.#registry.waitFor(
          sessionId,
          undefined,
          this.#registrationGraceMs,
        );
      } catch {
        entry = this.#registry.active(sessionId);
      }
    }
    if (!entry) {
      const tabId = this.#createTabId();
      await this.#requestUi({ action: "open", sessionId, tabId, url });
      entry = await this.#registry.waitForActive(sessionId, tabId, this.#uiTimeoutMs);
    } else if (entry.target.getURL() !== url) {
      try {
        await entry.target.loadURL(url);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("ERR_ABORTED") || entry.target.getURL() !== url) {
          throw error;
        }
      }
    }
    return pageSummary(entry);
  }

  async click(sessionId: string, selector: string): Promise<string> {
    const entry = this.#requireActive(sessionId);
    const result = await entry.target.executeJavaScript(`(() => {
      const find = (${FIND_ELEMENT_SOURCE});
      const selector = ${JSON.stringify(selector)};
      const element = find(selector);
      if (!(element instanceof HTMLElement)) throw new Error("No element matched: " + selector);
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      return { selector, text: element.innerText || element.getAttribute("aria-label") || "" };
    })()`, true) as {
      selector: string;
      text: string;
    };
    return `Clicked ${result.selector}${result.text ? ` (${result.text.slice(0, 120)})` : ""}`;
  }

  async type(
    sessionId: string,
    selector: string,
    text: string,
    submit = false,
  ): Promise<string> {
    const entry = this.#requireActive(sessionId);
    const result = await entry.target.executeJavaScript(`(() => {
      const find = (${FIND_ELEMENT_SOURCE});
      const selector = ${JSON.stringify(selector)};
      const text = ${JSON.stringify(text)};
      const submit = ${JSON.stringify(submit)};
      const element = find(selector);
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLElement && element.isContentEditable)) {
        throw new Error("Element is not editable: " + selector);
      }
      element.scrollIntoView({ block: "center", inline: "center" });
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(element, text);
        else element.value = text;
      } else {
        element.textContent = text;
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      if (submit) {
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
        element.closest("form")?.requestSubmit();
      }
      return { selector, textLength: text.length };
    })()`, true) as {
      selector: string;
      textLength: number;
    };
    return `Typed ${result.textLength} chars into ${result.selector}${submit ? " and submitted" : ""}`;
  }

  async getText(sessionId: string, selector?: string, maxChars = 30_000): Promise<string> {
    const entry = this.#requireActive(sessionId);
    const text = await entry.target.executeJavaScript(`(() => {
      const find = (${FIND_ELEMENT_SOURCE});
      const selector = ${JSON.stringify(selector ?? null)};
      const element = selector ? find(selector) : document.body;
      if (!(element instanceof HTMLElement)) throw new Error("No element matched: " + selector);
      return element.innerText || "";
    })()`) as string;
    if (text.length <= maxChars) return text || "(empty)";
    return `${text.slice(0, maxChars)}\n\n...[truncated; ${text.length - maxChars} more chars]`;
  }

  async evaluate(sessionId: string, expression: string): Promise<unknown> {
    return this.#requireActive(sessionId).target.executeJavaScript(expression, true);
  }

  async screenshot(
    sessionId: string,
    fullPage = false,
  ): Promise<{ media_type: "image/png"; data: string; tab_id: string; url: string }> {
    const entry = this.#requireActive(sessionId);
    const data = fullPage && entry.target.debugger
      ? await captureFullPage(entry)
      : (await entry.target.capturePage()).toPNG().toString("base64");
    return {
      media_type: "image/png",
      data,
      tab_id: entry.tabId,
      url: entry.target.getURL(),
    };
  }

  async close(sessionId: string): Promise<BrowserTabsResult> {
    const entry = this.#requireActive(sessionId);
    await this.#requestUi({ action: "close", sessionId, tabId: entry.tabId });
    await this.#registry.waitForMissing(sessionId, entry.tabId, this.#uiTimeoutMs);
    return this.#tabState(sessionId);
  }

  #requireActive(sessionId: string): BrowserViewEntry {
    const entry = this.#registry.active(sessionId);
    if (!entry) {
      throw new Error("No in-app browser tab is open for this chat");
    }
    return entry;
  }

  #entryFromInput(
    sessionId: string,
    input: Extract<BrowserTabsInput, { action: "select" | "close" }>,
  ): BrowserViewEntry {
    if (input.tab_id) {
      const entry = this.#registry.tab(sessionId, input.tab_id);
      if (entry) return entry;
      throw new Error(`Browser tab not found: ${input.tab_id}`);
    }
    if (Number.isInteger(input.index)) {
      const entry = this.#registry.list(sessionId)[input.index!];
      if (entry) return entry;
      throw new Error(`Browser tab index is out of range: ${input.index}`);
    }
    throw new Error("tab_id or index is required");
  }

  #tabState(sessionId: string): BrowserTabsResult {
    const tabs = this.#registry.list(sessionId).map((entry, index) => ({
      index,
      tab_id: entry.tabId,
      active: entry.active,
      url: entry.target.getURL(),
      title: entry.target.getTitle(),
    }));
    return {
      active_tab_id: tabs.find((tab) => tab.active)?.tab_id ?? null,
      tabs,
    };
  }
}

async function captureFullPage(entry: BrowserViewEntry): Promise<string> {
  const debuggerApi = entry.target.debugger!;
  if (debuggerApi.isAttached()) {
    throw new Error("Browser page annotation is active; finish it before taking a full-page screenshot");
  }
  debuggerApi.attach("1.3");
  try {
    await debuggerApi.sendCommand("Page.enable");
    const metrics = asRecord(await debuggerApi.sendCommand("Page.getLayoutMetrics"));
    const content = asRecord(metrics["cssContentSize"] ?? metrics["contentSize"]);
    const width = finitePositive(content["width"]);
    const height = finitePositive(content["height"]);
    const capture = asRecord(await debuggerApi.sendCommand("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      ...(width && height
        ? { clip: { x: 0, y: 0, width, height, scale: 1 } }
        : {}),
    }));
    const data = typeof capture["data"] === "string" ? capture["data"] : "";
    if (!data) throw new Error("Browser full-page screenshot was empty");
    return data;
  } finally {
    try {
      debuggerApi.detach();
    } catch {
      // Navigation can detach CDP while a capture is in flight.
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function pageSummary(entry: BrowserViewEntry): Record<string, unknown> {
  return {
    tab_id: entry.tabId,
    url: entry.target.getURL(),
    title: entry.target.getTitle(),
  };
}

function normalizeBrowserUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "about:blank";
  if (/^(https?|file|about):/i.test(value)) return value;
  throw new Error("Browser navigation requires an absolute http(s), file, or about URL");
}
