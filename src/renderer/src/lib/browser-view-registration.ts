import type {
  BrowserViewIdentityInput,
  BrowserViewRegistrationInput,
} from "@shared/browser-harness.js";

export interface BrowserViewRegistrationSource {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  getWebContentsId(): number;
}

export interface BrowserViewRegistrationOptions {
  sessionId: string;
  tabId: string;
  getActive(): boolean;
  register(input: BrowserViewRegistrationInput): Promise<void>;
  unregister(input: BrowserViewIdentityInput): Promise<void>;
  setActive?(input: BrowserViewIdentityInput): Promise<void>;
  onRegistered(webContentsId: number | null): void;
}

export function bindBrowserViewRegistration(
  webview: BrowserViewRegistrationSource,
  options: BrowserViewRegistrationOptions,
): () => void {
  let disposed = false;
  let pendingWebContentsId: number | null = null;
  let registeredWebContentsId: number | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const unregister = (webContentsId: number) => {
    void options.unregister({
      sessionId: options.sessionId,
      tabId: options.tabId,
      webContentsId,
    }).catch(() => undefined);
  };
  const retry = () => {
    if (disposed || retryTimer || registeredWebContentsId !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      register();
    }, 25);
  };
  const register = () => {
    if (disposed) return;
    try {
      const webContentsId = webview.getWebContentsId();
      if (
        pendingWebContentsId === webContentsId
        || registeredWebContentsId === webContentsId
      ) return;
      pendingWebContentsId = webContentsId;
      const active = options.getActive();
      void options.register({
        sessionId: options.sessionId,
        tabId: options.tabId,
        webContentsId,
        active,
      }).then(() => {
        pendingWebContentsId = null;
        if (disposed) {
          unregister(webContentsId);
          return;
        }
        registeredWebContentsId = webContentsId;
        options.onRegistered(webContentsId);
        if (!active && options.getActive()) {
          void options.setActive?.({
            sessionId: options.sessionId,
            tabId: options.tabId,
            webContentsId,
          }).catch(() => undefined);
        }
      }).catch(() => {
        pendingWebContentsId = null;
        retry();
      });
    } catch {
      // The guest may not have a webContents id until dom-ready.
      retry();
    }
  };
  webview.addEventListener("dom-ready", register);
  register();
  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    webview.removeEventListener("dom-ready", register);
    const webContentsId = registeredWebContentsId;
    registeredWebContentsId = null;
    options.onRegistered(null);
    if (webContentsId !== null) {
      unregister(webContentsId);
    }
  };
}
