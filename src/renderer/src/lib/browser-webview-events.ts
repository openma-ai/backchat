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

const FAVICON_MAX_BYTES = 256 * 1024;

function publishBrowserFavicon(
  webview: BrowserWebviewEventSource,
  callbacks: BrowserWebviewEventCallbacks,
  faviconUrl: string,
): void {
  if (/^data:image\//i.test(faviconUrl)) {
    callbacks.onPageMeta({ faviconUrl });
    return;
  }
  if (!/^https?:/i.test(faviconUrl)) return;

  const source = JSON.stringify(faviconUrl);
  void webview.executeJavaScript<string | null>(`
    (async () => {
      try {
        const response = await fetch(${source}, { credentials: "include" });
        if (!response.ok) return null;
        const blob = await response.blob();
        if (blob.size <= 0 || blob.size > ${FAVICON_MAX_BYTES}) return null;
        const type = blob.type.startsWith("image/") ? blob.type : "image/x-icon";
        const safeBlob = blob.type === type ? blob : new Blob([blob], { type });
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(
            typeof reader.result === "string" ? reader.result : null
          );
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(safeBlob);
        });
      } catch {
        return null;
      }
    })()
  `).then((dataUrl) => {
    if (dataUrl && /^data:image\//i.test(dataUrl)) {
      callbacks.onPageMeta({ faviconUrl: dataUrl });
    }
  }).catch(() => undefined);
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
    if (faviconUrl) publishBrowserFavicon(webview, callbacks, faviconUrl);
  };
  const onDomReady = () => {
    callbacks.onDomReady({
      url: webview.getURL(),
      zoomFactor: webview.getZoomFactor(),
    });
    void webview.executeJavaScript<string | null>(
      "document.querySelector('link[rel~=\"icon\"], link[rel=\"shortcut icon\"]')?.href ?? null",
    ).then((faviconUrl) => {
      if (faviconUrl) publishBrowserFavicon(webview, callbacks, faviconUrl);
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
