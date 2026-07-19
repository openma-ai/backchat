import { describe, expect, it, vi } from "vitest";

import {
  bindBrowserWebviewEvents,
  type BrowserWebviewEventCallbacks,
} from "./browser-webview-events";

class FakeWebview {
  readonly listeners = new Map<string, Set<EventListener>>();
  url = "https://example.test/start";
  canBack = false;
  canForward = false;
  zoomFactor = 1;
  faviconUrl: string | null = null;

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, detail: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(detail as unknown as Event);
    }
  }

  canGoBack(): boolean {
    return this.canBack;
  }

  canGoForward(): boolean {
    return this.canForward;
  }

  getURL(): string {
    return this.url;
  }

  getZoomFactor(): number {
    return this.zoomFactor;
  }

  async executeJavaScript<T>(): Promise<T> {
    return this.faviconUrl as T;
  }
}

function callbacks(
  overrides: Partial<BrowserWebviewEventCallbacks> = {},
): BrowserWebviewEventCallbacks {
  return {
    onNavigation: vi.fn(),
    onPageMeta: vi.fn(),
    onDomReady: vi.fn(),
    onMainFrameNavigationStart: vi.fn(),
    onLoadStop: vi.fn(),
    onCacheFrame: vi.fn(),
    ...overrides,
  };
}

describe("bindBrowserWebviewEvents", () => {
  it("publishes history and URL state for browser navigations", () => {
    const webview = new FakeWebview();
    const onNavigation = vi.fn();

    bindBrowserWebviewEvents(webview, callbacks({ onNavigation }));
    webview.canBack = true;
    webview.url = "https://example.test/next";
    webview.emit("did-navigate");

    expect(onNavigation).toHaveBeenCalledWith({
      canBack: true,
      canForward: false,
      url: "https://example.test/next",
    });
  });

  it("publishes same-document navigation state", () => {
    const webview = new FakeWebview();
    const onNavigation = vi.fn();

    bindBrowserWebviewEvents(webview, callbacks({ onNavigation }));
    webview.canForward = true;
    webview.url = "https://example.test/start#details";
    webview.emit("did-navigate-in-page");

    expect(onNavigation).toHaveBeenCalledWith({
      canBack: false,
      canForward: true,
      url: "https://example.test/start#details",
    });
  });

  it("publishes non-empty trimmed page titles", () => {
    const webview = new FakeWebview();
    const onPageMeta = vi.fn();

    bindBrowserWebviewEvents(webview, callbacks({ onPageMeta }));
    webview.emit("page-title-updated", { title: "  Settings  " });
    webview.emit("page-title-updated", { title: "   " });

    expect(onPageMeta).toHaveBeenCalledTimes(1);
    expect(onPageMeta).toHaveBeenCalledWith({ title: "Settings" });
  });

  it("publishes the first supported page favicon", () => {
    const webview = new FakeWebview();
    const onPageMeta = vi.fn();

    bindBrowserWebviewEvents(webview, callbacks({ onPageMeta }));
    webview.emit("page-favicon-updated", {
      favicons: [
        "file:///tmp/icon.png",
        "data:image/png;base64,icon",
        "https://example.test/favicon.ico",
      ],
    });

    expect(onPageMeta).toHaveBeenCalledWith({
      faviconUrl: "data:image/png;base64,icon",
    });
  });

  it("publishes ready state and caches the frame on DOM ready", async () => {
    const webview = new FakeWebview();
    webview.url = "https://example.test/ready";
    webview.zoomFactor = 1.25;
    webview.faviconUrl = "https://example.test/icon.png";
    const onDomReady = vi.fn();
    const onPageMeta = vi.fn();
    const onCacheFrame = vi.fn();

    bindBrowserWebviewEvents(
      webview,
      callbacks({ onDomReady, onPageMeta, onCacheFrame }),
    );
    webview.emit("dom-ready");

    expect(onDomReady).toHaveBeenCalledWith({
      url: "https://example.test/ready",
      zoomFactor: 1.25,
    });
    expect(onCacheFrame).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(onPageMeta).toHaveBeenCalledWith({
        faviconUrl: "https://example.test/icon.png",
      });
    });
  });

  it("publishes navigation starts only for the main frame", () => {
    const webview = new FakeWebview();
    const onMainFrameNavigationStart = vi.fn();

    bindBrowserWebviewEvents(
      webview,
      callbacks({ onMainFrameNavigationStart }),
    );
    webview.emit("did-start-navigation", { isMainFrame: false });
    webview.emit("did-start-navigation", { isMainFrame: true });

    expect(onMainFrameNavigationStart).toHaveBeenCalledOnce();
  });

  it("publishes load completion and refreshes the cached frame", () => {
    const webview = new FakeWebview();
    const onLoadStop = vi.fn();
    const onCacheFrame = vi.fn();

    bindBrowserWebviewEvents(
      webview,
      callbacks({ onLoadStop, onCacheFrame }),
    );
    webview.emit("did-stop-loading");

    expect(onLoadStop).toHaveBeenCalledOnce();
    expect(onCacheFrame).toHaveBeenCalledOnce();
  });
});
