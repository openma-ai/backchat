export interface BrowserWebviewEventSource {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getZoomFactor(): number;
  executeJavaScript<T>(code: string): Promise<T>;
}

export interface BrowserWebviewEventCallbacks {
  onNavigation(state: {
    canBack: boolean;
    canForward: boolean;
    url: string;
  }): void;
  onPageMeta(meta: { title?: string; faviconUrl?: string }): void;
  onDomReady(state: { url: string; zoomFactor: number }): void;
  onMainFrameNavigationStart(): void;
  onLoadStop(): void;
  onCacheFrame(): void;
}

export function bindBrowserWebviewEvents(
  webview: BrowserWebviewEventSource,
  callbacks: BrowserWebviewEventCallbacks,
): () => void {
  const onDidNavigate = () => {
    callbacks.onNavigation({
      canBack: webview.canGoBack(),
      canForward: webview.canGoForward(),
      url: webview.getURL(),
    });
  };
  const onTitleUpdated: EventListener = (event) => {
    const title = (event as Event & { title?: string }).title?.trim();
    if (title) callbacks.onPageMeta({ title });
  };
  const onFaviconUpdated: EventListener = (event) => {
    const faviconUrl = (
      event as Event & { favicons?: string[] }
    ).favicons?.find((candidate) => /^(https?|data):/i.test(candidate));
    if (faviconUrl) callbacks.onPageMeta({ faviconUrl });
  };
  const onDomReady = () => {
    callbacks.onDomReady({
      url: webview.getURL(),
      zoomFactor: webview.getZoomFactor(),
    });
    void webview.executeJavaScript<string | null>(
      "document.querySelector('link[rel~=\"icon\"], link[rel=\"shortcut icon\"]')?.href ?? null",
    ).then((faviconUrl) => {
      if (faviconUrl && /^(https?|data):/i.test(faviconUrl)) {
        callbacks.onPageMeta({ faviconUrl });
      }
    }).catch(() => undefined);
    callbacks.onCacheFrame();
  };
  const onNavigationStart: EventListener = (event) => {
    const isMainFrame = (event as Event & { isMainFrame?: boolean }).isMainFrame;
    if (isMainFrame === false) return;
    callbacks.onMainFrameNavigationStart();
  };
  const onLoadStop = () => {
    callbacks.onLoadStop();
    callbacks.onCacheFrame();
  };

  webview.addEventListener("did-navigate", onDidNavigate);
  webview.addEventListener("did-navigate-in-page", onDidNavigate);
  webview.addEventListener("page-title-updated", onTitleUpdated);
  webview.addEventListener("page-favicon-updated", onFaviconUpdated);
  webview.addEventListener("dom-ready", onDomReady);
  webview.addEventListener("did-start-navigation", onNavigationStart);
  webview.addEventListener("did-stop-loading", onLoadStop);
  return () => {
    webview.removeEventListener("did-navigate", onDidNavigate);
    webview.removeEventListener("did-navigate-in-page", onDidNavigate);
    webview.removeEventListener("page-title-updated", onTitleUpdated);
    webview.removeEventListener("page-favicon-updated", onFaviconUpdated);
    webview.removeEventListener("dom-ready", onDomReady);
    webview.removeEventListener("did-start-navigation", onNavigationStart);
    webview.removeEventListener("did-stop-loading", onLoadStop);
  };
}
